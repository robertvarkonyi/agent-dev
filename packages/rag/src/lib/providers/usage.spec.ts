import { describe, it, expect } from 'vitest';
import { UsageTracker } from './usage.js';

describe('UsageTracker', () => {
  it('provider:model szerint összegzi a hívásokat és a tokeneket', () => {
    const t = new UsageTracker();
    t.add('openai', 'text-embedding-3-small', 100);
    t.add('openai', 'text-embedding-3-small', 50);
    t.add('anthropic', 'claude-haiku-4-5', 20);
    const snap = t.snapshot();
    expect(snap.find((u) => u.provider === 'openai')).toEqual({
      provider: 'openai',
      model: 'text-embedding-3-small',
      calls: 2,
      tokens: 150,
    });
    expect(snap.find((u) => u.provider === 'anthropic')?.calls).toBe(1);
    expect(t.totalTokens()).toBe(170);
  });

  it('ugyanaz a provider más modellel külön sor', () => {
    const t = new UsageTracker();
    t.add('anthropic', 'claude-haiku-4-5', 10);
    t.add('anthropic', 'claude-sonnet-4-6', 30);
    expect(t.snapshot()).toHaveLength(2);
  });

  it('üres trackernél üres snapshot és 0 token', () => {
    const t = new UsageTracker();
    expect(t.snapshot()).toEqual([]);
    expect(t.totalTokens()).toBe(0);
  });
});
