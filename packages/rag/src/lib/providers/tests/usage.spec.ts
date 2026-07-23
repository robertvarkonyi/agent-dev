import { describe, it, expect } from 'vitest';
import { UsageTracker, toTokenBreakdown, UsageFn } from '../usage.js';

describe('UsageTracker', () => {
  it('provider:fn szerint összegzi a hívásokat és a tokeneket', () => {
    const t = new UsageTracker();

    t.add('openai', 'text-embedding-3-small', UsageFn.embedding, 100);
    t.add('openai', 'text-embedding-3-small', UsageFn.embedding, 50);
    t.add('anthropic', 'claude-haiku-4-5', UsageFn.hyde, 20);

    const snap = t.snapshot();

    expect(snap.find((u) => u.fn === 'embedding')).toEqual({
      provider: 'openai',
      model: 'text-embedding-3-small',
      fn: 'embedding',
      calls: 2,
      tokens: 150,
    });
    expect(snap.find((u) => u.fn === 'hyde')?.calls).toBe(1);
    expect(t.totalTokens()).toBe(170);
  });

  it('azonos provider, két funkció (hyde vs rag-answer) két külön sor', () => {
    const t = new UsageTracker();

    t.add('anthropic', 'claude-haiku-4-5', UsageFn.hyde, 10);
    t.add('anthropic', 'claude-sonnet-4-6', UsageFn.answer, 30);

    expect(t.snapshot()).toHaveLength(2);
  });

  it('üres trackernél üres snapshot és 0 token', () => {
    const t = new UsageTracker();

    expect(t.snapshot()).toEqual([]);
    expect(t.totalTokens()).toBe(0);
  });
});

describe('toTokenBreakdown', () => {
  it('a snapshotból provider+fn+tokens sorokat és összeget képez', () => {
    const t = new UsageTracker();

    t.add('openai', 'text-embedding-3-small', UsageFn.embedding, 100);
    t.add('anthropic', 'claude-sonnet-4-6', UsageFn.agent, 40);

    const breakdown = toTokenBreakdown(t.snapshot());

    expect(breakdown.rows).toEqual([
      { provider: 'openai', fn: 'embedding', tokens: 100 },
      { provider: 'anthropic', fn: 'agent', tokens: 40 },
    ]);
    expect(breakdown.total).toBe(140);
  });

  it('üres bemenetre üres sorok és 0 összeg', () => {
    expect(toTokenBreakdown([])).toEqual({ rows: [], total: 0 });
  });
});
