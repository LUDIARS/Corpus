/** Private exact-byte captures with bounded memory, total bytes and concurrent leases.
 * @implements SPEC-HUB-BOUND-SERVICE-SESSION
 */
import { openAsBlob } from 'node:fs';
import { mkdtemp, open, rmdir, unlink, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { OperationBodyError } from './service-operation-body.ts';

export interface CaptureLimits { maximumBytes: number; timeoutSeconds: number; byteLength?: number; expiresAt?: string; signal?: AbortSignal }
export interface OwnedBodyCapture { body: Blob; dispose: () => Promise<void> }
export class CaptureUnavailableError extends Error { constructor() { super('Private upload capacity is unavailable'); } }

/** No path/body/limit comes from the browser; hosts declare these per route. */
export class UploadCapturePool {
  private leases = 0;
  private bytes = 0;
  private readonly totalLimit: number;
  private readonly concurrentLimit: number;
  private readonly memoryLimit: number;
  private readonly temporaryRoot: string;
  constructor(options: { maximumTotalBytes?: number; maximumConcurrent?: number; memoryBytes?: number; temporaryRoot?: string } = {}) {
    this.totalLimit = options.maximumTotalBytes ?? 512 * 1024 * 1024;
    this.concurrentLimit = options.maximumConcurrent ?? 8;
    this.memoryLimit = options.memoryBytes ?? 1024 * 1024;
    this.temporaryRoot = options.temporaryRoot ?? resolve(tmpdir());
    if (!Number.isSafeInteger(this.totalLimit) || this.totalLimit < 1 || this.totalLimit > 512 * 1024 * 1024
      || !Number.isSafeInteger(this.concurrentLimit) || this.concurrentLimit < 1 || this.concurrentLimit > 8
      || !Number.isSafeInteger(this.memoryLimit) || this.memoryLimit < 1 || this.memoryLimit > 1024 * 1024
      || !isAbsolute(this.temporaryRoot) || /^[/\\]{2}/.test(this.temporaryRoot)) throw new Error('Invalid private capture pool limits');
  }
  async capture(request: Request, limits: CaptureLimits): Promise<OwnedBodyCapture> {
    const maximum = limits.maximumBytes, timeout = limits.timeoutSeconds, expected = limits.byteLength;
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 200 * 1024 * 1024 || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 300
      || expected !== undefined && (!Number.isSafeInteger(expected) || expected < 1 || expected > maximum)) throw new Error('A bounded upload route is required');
    const declared = request.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum || expected !== undefined && Number(declared) !== expected)) throw new OperationBodyError(413);
    if (!request.body || request.bodyUsed || request.body.locked) throw new OperationBodyError(400);
    const deadline = Math.min(Date.now() + timeout * 1000, limits.expiresAt === undefined ? Infinity : Date.parse(limits.expiresAt));
    if (!Number.isFinite(deadline) || deadline <= Date.now()) throw new OperationBodyError(408);
    let charged = expected ?? 0;
    if (this.leases >= this.concurrentLimit || this.bytes + charged > this.totalLimit) throw new CaptureUnavailableError();
    this.leases++; this.bytes += charged;
    let length = 0, chunks: Uint8Array<ArrayBuffer>[] = [], directory: string | undefined, file: string | undefined, handle: FileHandle | undefined;
    let cleanup: Promise<void> | undefined;
    const dispose = (): Promise<void> => cleanup ??= (async () => {
      if (handle) { const pending = handle; handle = undefined; await pending.close(); }
      if (file) { await unlink(file).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); file = undefined; }
      if (directory) { await rmdir(directory).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); directory = undefined; }
      chunks = [];
      this.bytes -= charged; this.leases--;
    })();
    const controller = new AbortController();
    const signal = AbortSignal.any([request.signal, controller.signal, ...(limits.signal ? [limits.signal] : [])]);
    const reader = request.body.getReader(); let ended = false;
    const cancel = (): void => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now())); timer.unref?.();
    try {
      while (true) {
        if (signal.aborted || Date.now() >= deadline) throw new OperationBodyError(408);
        const part = await reader.read();
        if (signal.aborted || Date.now() >= deadline) throw new OperationBodyError(408);
        if (part.done) { ended = true; break; }
        length += part.value.byteLength;
        if (length > maximum || expected !== undefined && length > expected) throw new OperationBodyError(413);
        if (expected === undefined) {
          if (this.bytes + part.value.byteLength > this.totalLimit) throw new CaptureUnavailableError();
          charged += part.value.byteLength; this.bytes += part.value.byteLength;
        }
        const chunk = Uint8Array.from(part.value);
        if (!handle && length <= this.memoryLimit) { chunks.push(chunk); continue; }
        if (!handle) {
          const temporaryRoot = resolve(this.temporaryRoot);
          directory = await mkdtemp(join(temporaryRoot, 'corpus-upload-'));
          if (dirname(directory) !== temporaryRoot) throw new Error('Unexpected private spool path');
          file = join(directory, 'body'); handle = await open(file, 'wx', 0o600);
          for (const pending of chunks) await handle.writeFile(pending);
          chunks = [];
        }
        await handle.writeFile(chunk);
      }
      if (length < 1 || expected !== undefined && length !== expected || declared !== null && length !== Number(declared)) throw new OperationBodyError(400);
      if (handle) { await handle.close(); handle = undefined; }
      const body = file ? await openAsBlob(file) : new Blob(chunks);
      if (body.size !== length) throw new OperationBodyError(400);
      return { body, dispose };
    } catch (error) { await dispose(); throw error; }
    finally {
      clearTimeout(timer); signal.removeEventListener('abort', cancel);
      if (!ended) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
export const operationCapturePool = new UploadCapturePool();
