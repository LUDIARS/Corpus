/** @implements SPEC-HUB-BOUND-SERVICE-SESSION */
import { describe, expect, it } from 'vitest';
import { openBlobTransfer } from './upload-transfer.ts';

describe('owned captured-body transfer lifetime', () => {
  it('transfers exact binary bytes and disposes an already completed reader idempotently', async () => {
    const bytes = new Uint8Array([0, 255, 13, 10, 128]), owner = new AbortController();
    const transfer = openBlobTransfer(new Blob([bytes]), owner.signal);
    expect(new Uint8Array(await new Response(transfer.body).arrayBuffer())).toEqual(bytes);
    await transfer.dispose(); await transfer.dispose();
  });
  it('awaits the underlying asynchronous close even when the HTTP consumer keeps its output locked', async () => {
    let release!: () => void, closed = false;
    const closing = new Promise<void>(resolve => { release = resolve; });
    const source = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([7])); },
      async cancel() { await closing; closed = true; },
    });
    class Captured extends Blob { override stream() { return source; } }
    const transfer = openBlobTransfer(new Captured(['7']), new AbortController().signal), consumer = transfer.body.getReader();
    expect((await consumer.read()).value).toEqual(new Uint8Array([7]));
    const failed = expect(consumer.closed).rejects.toMatchObject({ name: 'AbortError' });
    let disposed = false;
    const pending = transfer.dispose(), completed = pending.then(() => { disposed = true; });
    expect(transfer.dispose()).toBe(pending);
    await Promise.resolve(); expect(closed).toBe(false); expect(disposed).toBe(false);
    release(); await completed; await failed;
    expect(closed).toBe(true); expect(disposed).toBe(true); expect(source.locked).toBe(false);
    consumer.releaseLock();
  });
  it('cancels and releases a stalled source on request disconnect', async () => {
    let cancelled = false;
    const source = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    class Captured extends Blob { override stream() { return source; } }
    const owner = new AbortController(), transfer = openBlobTransfer(new Captured(['pending']), owner.signal);
    const consumer = transfer.body.getReader(), reading = consumer.read();
    const failed = expect(reading).rejects.toBeDefined();
    const closed = expect(consumer.closed).rejects.toBeDefined();
    owner.abort(); await transfer.dispose(); await failed; await closed;
    expect(cancelled).toBe(true); expect(source.locked).toBe(false); consumer.releaseLock();
  });
});
