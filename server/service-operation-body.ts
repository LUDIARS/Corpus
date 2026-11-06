/** Bounded exact bytes shared by Cr authorization and the eventual route parser.
 * @implements SPEC-HUB-BOUND-SERVICE-SESSION
 */
import type { Context } from 'hono';

export class OperationBodyError extends Error {
  constructor(readonly status: 400 | 408 | 413) { super('Operation body cannot be authorized'); }
}

export async function readOperationBody(c: Context, maximumBytes: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || maximumBytes > 32 * 1024 * 1024) {
    throw new Error('A bounded route-owned operation body size is required');
  }
  const request = c.req.raw;
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) throw new OperationBodyError(413);
  if (!request.body) return new Uint8Array();
  if (request.bodyUsed || Object.keys(c.req.bodyCache).length) throw new OperationBodyError(400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let ended = false;
  let cancelled = false;
  const cancel = (): void => { cancelled = true; void reader.cancel().catch(() => { /* reader may already be closed */ }); };
  request.signal.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, 15_000);
  timeout.unref?.();
  try {
    if (request.signal.aborted) cancel();
    while (true) {
      const part = await reader.read();
      if (cancelled) throw new OperationBodyError(408);
      if (part.done) { ended = true; break; }
      length += part.value.byteLength;
      if (length > maximumBytes) throw new OperationBodyError(413);
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    // Replay exactly the authorized bytes, including multipart boundaries, for
    // both raw Request consumers and Hono's cached JSON/form/body helpers.
    c.req.raw = new Request(request, { body: bytes, duplex: 'half' } as RequestInit);
    return bytes;
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', cancel);
    if (!ended) await reader.cancel().catch(() => { /* failed/aborted input has no remaining owner */ });
    reader.releaseLock();
  }
}
