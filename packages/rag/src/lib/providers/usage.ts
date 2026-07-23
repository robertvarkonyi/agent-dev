// A provider-hívások funkció-címkéi (egyetlen forrás; a valós providerek és a FakeProviders is
// ebből veszik a címkét, hogy ne driftelhessen szét). A `rag-answer` a grounded RAG-válasz, az
// `agent` az orchestrátor-modell (NL→SQL tool-use loop).
export const UsageFn = {
  embedding: 'embedding',
  hyde: 'hyde',
  rerank: 'rerank',
  answer: 'rag-answer',
  agent: 'agent',
} as const;

export type UsageFnName = (typeof UsageFn)[keyof typeof UsageFn];

export interface ProviderUsage {
  provider: string;
  model: string;
  fn: string;
  calls: number;
  tokens: number;
}

// Provider-hívások token-fogyasztásának gyűjtője (side-channel). Az éles provider-implementációk
// írják (a válaszban kapott usage alapján); a FakeProviders csak ha trackert kap. A kulcs
// `provider:fn`, így ugyanaz a provider más funkcióval (pl. anthropic hyde vs rag-answer) külön sor.
export class UsageTracker {
  private readonly byKey = new Map<string, ProviderUsage>();

  add(provider: string, model: string, fn: UsageFnName, tokens: number): void {
    const key = `${provider}:${fn}`;
    const cur = this.byKey.get(key) ?? {
      provider,
      model,
      fn,
      calls: 0,
      tokens: 0,
    };

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

// A megjelenítéshez levékonyított alak: soronként (provider, fn, tokens) + összeg. A CLI ezt
// rendereli (ask/chat és rag:index/golden is), az agent ezt adja vissza a tokenBreakdown-ben.
export interface TokenBreakdown {
  rows: { provider: string; fn: string; tokens: number }[];
  total: number;
}

export function toTokenBreakdown(usage: ProviderUsage[]): TokenBreakdown {
  const rows = usage.map((u) => ({
    provider: u.provider,
    fn: u.fn,
    tokens: u.tokens,
  }));

  const total = rows.reduce((sum, r) => sum + r.tokens, 0);

  return { rows, total };
}
