/** Corpus自身の資源のみを逆順で解放する。host/pluginの共有資源は所有しない。 */
export class CleanupScope {
  private readonly actions: Array<() => void | Promise<void>> = [];
  private closing: Promise<void> | undefined;
  defer(action: () => void | Promise<void>): void {
    if (this.closing) throw new Error('Corpus cleanup already started');
    this.actions.push(action);
  }
  close(): Promise<void> {
    this.closing ??= Promise.resolve().then(async () => {
      const failures: unknown[] = [];
      for (const action of this.actions.reverse()) {
        try { await action(); } catch (error) { failures.push(error); }
      }
      this.actions.length = 0;
      if (failures.length) throw new AggregateError(failures, 'Corpus cleanup failed');
    });
    return this.closing;
  }
}
export interface CorpusRuntime { close(): Promise<void> }
