import { describe, it, expect } from 'vitest';
import { formatTokenBreakdown, formatProviderUsage } from './token-report.js';

describe('formatTokenBreakdown', () => {
  it('provider+fn soronként, plusz Összesen sor', () => {
    const out = formatTokenBreakdown({
      rows: [
        { provider: 'openai', fn: 'embedding', tokens: 1240 },
        { provider: 'anthropic', fn: 'rag-answer', tokens: 2110 },
        { provider: 'anthropic', fn: 'agent', tokens: 1540 },
      ],
      total: 4890,
    });

    expect(out).toContain('Token-használat');
    expect(out).toContain('embedding');
    expect(out).toContain('rag-answer');
    expect(out).toContain('agent');
    expect(out).toContain('Összesen');
    // Fejléc + 3 sor + elválasztó + összeg = 6 sor.
    expect(out.split('\n')).toHaveLength(6);
  });

  it('üres breakdownnál beszédes egysoros üzenet', () => {
    const out = formatTokenBreakdown({ rows: [], total: 0 });

    expect(out).toContain('nincs');
    expect(out.split('\n')).toHaveLength(1);
  });
});

describe('formatProviderUsage', () => {
  it('provider (model) [fn]: token, hívás soronként + Összesen', () => {
    const out = formatProviderUsage(
      [
        {
          provider: 'openai',
          model: 'text-embedding-3-small',
          fn: 'embedding',
          calls: 3,
          tokens: 1240,
        },
        {
          provider: 'anthropic',
          model: 'claude-haiku-4-5',
          fn: 'rag-answer',
          calls: 1,
          tokens: 2110,
        },
      ],
      3350,
    );

    expect(out).toContain('text-embedding-3-small');
    expect(out).toContain('[embedding]');
    expect(out).toContain('3 hívás');
    expect(out).toContain('Összesen');
    // Fejléc + 2 sor + Összesen = 4 sor.
    expect(out.split('\n')).toHaveLength(4);
  });

  it('üres usage → beszédes egysoros üzenet', () => {
    expect(formatProviderUsage([], 0)).toContain('nincs');
  });
});
