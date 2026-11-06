/** @implements SPEC-HUB-BOUND-SERVICE-SESSION */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CaptureUnavailableError, UploadCapturePool, type OwnedBodyCapture } from './upload-capture.ts';

const roots: string[] = [], captures: OwnedBodyCapture[] = [];
async function fixture(options: { maximumTotalBytes?: number; maximumConcurrent?: number; memoryBytes?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'corpus-capture-contract-')); roots.push(root);
  return { root, pool: new UploadCapturePool({ ...options, temporaryRoot: root }) };
}
const request = (body: string | Uint8Array<ArrayBuffer>, headers?: Record<string, string>): Request => new Request('https://hub.example/media', { method: 'PUT', body, headers });
const limits = { maximumBytes: 32, timeoutSeconds: 5 };
afterEach(async () => {
  for (const capture of captures.splice(0)) await capture.dispose();
  // Remove only this contract's empty directories. Never recursively delete temp.
  for (const root of roots.splice(0)) await rmdir(root);
});

describe('private exact-byte upload capture', () => {
  it('reserves an exact2GiB arrival using safe-number quota accounting without materializing its body', async () => {
    const maximum = 2 ** 31, { pool, root } = await fixture({ maximumTotalBytes: maximum + 1 });
    const controller = new AbortController(), stream = new ReadableStream<Uint8Array>();
    const incoming = new Request('https://hub.example/media', { method: 'PUT', body: stream, signal: controller.signal, duplex: 'half' } as RequestInit);
    const pending = pool.capture(incoming, { maximumBytes: maximum, byteLength: maximum, timeoutSeconds: 300 });
    await expect(pool.capture(request('12'), { ...limits, byteLength: 2 })).rejects.toBeInstanceOf(CaptureUnavailableError);
    controller.abort(); await expect(pending).rejects.toThrow(); expect(await readdir(root)).toEqual([]);
    const next = await pool.capture(request('ok'), limits); captures.push(next);
    await expect(pool.capture(request('x'), { maximumBytes: maximum + 1, timeoutSeconds: 300 })).rejects.toThrow();
    expect(() => new UploadCapturePool({ maximumTotalBytes: 4 * 1024 ** 3 + 1 })).toThrow();
  });
  it('spills to its private directory, preserves binary bytes and releases an idempotent lease', async () => {
    const { root, pool } = await fixture({ memoryBytes: 2, maximumConcurrent: 1 });
    const bytes = new Uint8Array([0, 255, 10, 13, 128]);
    const captured = await pool.capture(request(bytes), { ...limits, byteLength: bytes.length }); captures.push(captured);
    expect(new Uint8Array(await captured.body.arrayBuffer())).toEqual(bytes);
    expect(await readdir(root)).toHaveLength(1);
    await expect(pool.capture(request('x'), limits)).rejects.toBeInstanceOf(CaptureUnavailableError);
    await Promise.all([captured.dispose(), captured.dispose()]);
    expect(await readdir(root)).toEqual([]);
    const replacement = await pool.capture(request('y'), limits); captures.push(replacement);
    expect(await replacement.body.text()).toBe('y');
  });
  it('rejects oversize, truncated and dishonest declared bodies and cleans every failed spool', async () => {
    const { root, pool } = await fixture({ memoryBytes: 1, maximumConcurrent: 1 });
    for (const [body, declared, expected] of [
      ['12345', undefined, 4], ['123', undefined, 4], ['123', '4', undefined], ['12345', '3', undefined],
    ] as const) {
      await expect(pool.capture(request(body, declared ? { 'content-length': declared } : undefined), { ...limits, byteLength: expected })).rejects.toThrow();
      expect(await readdir(root)).toEqual([]);
    }
    const captured = await pool.capture(request('ok'), limits); captures.push(captured);
  });
  it('accounts retained bytes across completed captures before admitting another body', async () => {
    const { pool } = await fixture({ maximumTotalBytes: 5 });
    const first = await pool.capture(request('1234'), { ...limits, byteLength: 4 }); captures.push(first);
    await expect(pool.capture(request('12'), { ...limits, byteLength: 2 })).rejects.toBeInstanceOf(CaptureUnavailableError);
    await expect(pool.capture(request('12'), limits)).rejects.toBeInstanceOf(CaptureUnavailableError);
    await first.dispose();
    const next = await pool.capture(request('12345'), limits); captures.push(next);
  });
  it('cancels a pending reader on disconnect and returns capacity', async () => {
    const { root, pool } = await fixture({ maximumConcurrent: 1 });
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const controller = new AbortController();
    const incoming = new Request('https://hub.example/media', { method: 'PUT', body, signal: controller.signal, duplex: 'half' } as RequestInit);
    const pending = pool.capture(incoming, limits); controller.abort();
    await expect(pending).rejects.toThrow(); expect(cancelled).toBe(true);
    expect(await readdir(root)).toEqual([]);
    const next = await pool.capture(request('ok'), limits); captures.push(next);
  });
  it('refuses locked, consumed and already expired inputs before allocating a spool', async () => {
    const { root, pool } = await fixture();
    const locked = request('locked'), reader = locked.body!.getReader();
    await expect(pool.capture(locked, limits)).rejects.toThrow(); await reader.cancel(); reader.releaseLock();
    const consumed = request('used'); await consumed.text();
    await expect(pool.capture(consumed, limits)).rejects.toThrow();
    await expect(pool.capture(request('late'), { ...limits, expiresAt: '2000-01-01T00:00:00.000Z' })).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
  });
});
