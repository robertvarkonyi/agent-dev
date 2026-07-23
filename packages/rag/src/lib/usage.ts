export interface ProviderUsage {
  provider: string;
  model: string;
  calls: number;
  tokens: number;
}

// Provider-hívások token-fogyasztásának gyűjtője (side-channel). Az éles provider-implementációk
// írják (a válaszban kapott usage alapján); a FakeProviders nem. A pipeline-parancsok (pl. rag:index)
// a végén kiírják a snapshotot providerenként. A Providers.embed/rerank/hyde/answer szerződése
// változatlan marad — a tracker nem a visszatérési értéken, hanem ezen az oldalcsatornán utazik.
export class UsageTracker {
  private readonly byKey = new Map<string, ProviderUsage>();

  add(provider: string, model: string, tokens: number): void {
    const key = `${provider}:${model}`;
    const cur = this.byKey.get(key) ?? { provider, model, calls: 0, tokens: 0 };
    cur.calls += 1;
    cur.tokens += tokens;
    this.byKey.set(key, cur);
  }

  snapshot(): ProviderUsage[] {
    return [...this.byKey.values()];
  }

  totalTokens(): number {
    return this.snapshot().reduce((sum, u) => sum + u.tokens, 0);
  }
}
