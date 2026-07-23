import { describe, it, expect } from 'vitest';
import { formatTokenBreakdown } from './token-report.js';

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
