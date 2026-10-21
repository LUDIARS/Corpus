/** Process-local token lifetime policy; no token material is persisted. */
export class DownstreamTokenCache {
  private readonly entries = new Map<string, { token: string; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  get(key: string): string | undefined {
    this.sweep();
    return this.entries.get(key)?.token;
  }

  set(key: string, token: string, expiresAt: number): void {
    this.entries.set(key, { token, expiresAt });
    this.sweep();
    if (this.entries.size > 1024) {
      const earliest = [...this.entries].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
      for (const [key] of earliest) {
        if (this.entries.size <= 1024) break;
        this.entries.delete(key);
      }
    }
  }

  private sweep(): void {
    const boundary = this.now() + 30_000;
    for (const [key, value] of this.entries) {
      if (value.expiresAt <= boundary) this.entries.delete(key);
    }
  }
}
