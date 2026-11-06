/** The owner can finish a Blob reader even while an HTTP consumer holds the output lock.
 * @implements SPEC-HUB-BOUND-SERVICE-SESSION
 */
export interface OwnedBlobTransfer { body: ReadableStream<Uint8Array>; dispose: () => Promise<void> }
export function openBlobTransfer(body: Blob, signal: AbortSignal): OwnedBlobTransfer {
  signal.throwIfAborted();
  const reader = body.stream().getReader();
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let active: ReturnType<typeof reader.read> | undefined;
  let ended = false, released = false, stopping: Promise<void> | undefined;
  const release = (): void => {
    signal.removeEventListener('abort', abort);
    if (!released) { reader.releaseLock(); released = true; }
  };
  const stop = (reason: unknown): Promise<void> => {
    if (stopping) return stopping;
    if (ended) return Promise.resolve();
    ended = true; controller.error(reason);
    stopping = (async () => {
      try { await reader.cancel(reason); }
      finally {
        // A pending pull also owns this reader. Its rejection is delivered to
        // the output consumer; teardown waits until it relinquishes ownership.
        if (active) await active.catch(() => {});
        release();
      }
    })();
    return stopping;
  };
  const abort = (): void => { void stop(signal.reason).catch(() => { /* The explicit owner disposal awaits the same failure. */ }); };
  const output = new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
    async pull(value) {
      if (ended) return;
      const pending = reader.read(); active = pending;
      try {
        const part = await pending;
        if (ended) return;
        if (part.done) { ended = true; value.close(); release(); }
        else value.enqueue(Uint8Array.from(part.value));
      } catch (error) {
        if (!ended) { ended = true; value.error(error); release(); }
      } finally { if (active === pending) active = undefined; }
    },
    cancel: reason => stop(reason),
  });
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  return { body: output, dispose: () => stop(new DOMException('Upload owner ended', 'AbortError')) };
}
