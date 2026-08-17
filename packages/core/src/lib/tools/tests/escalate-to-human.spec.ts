import { describe, it, expect, vi } from 'vitest';
import {
  buildEscalateToHuman,
  type EscalationSink,
} from '../escalate-to-human.js';
import type { EscalationTicket } from '../../shared/escalation-queue.js';

function fakeTicket(over: Partial<EscalationTicket> = {}): EscalationTicket {
  return {
    ticketId: 'esc_test',
    ts: '2026-08-17T10:00:00.000Z',
    reason: 'out_of_scope',
    customerMessage: 'Hol tart a rendelésem?',
    summary: 'Rendelés-státusz, nincs rá adat.',
    status: 'open',
    ...over,
  };
}

describe('buildEscalateToHuman', () => {
  it('a sinken át jegyet hoz létre, és a ticketId-t + megerősítést adja vissza', async () => {
    const create = vi.fn((): EscalationTicket => fakeTicket());
    const sink: EscalationSink = { create };

    const tool = buildEscalateToHuman(sink);
    const out = await tool.execute!(
      {
        reason: 'out_of_scope',
        customerMessage: 'Hol tart a rendelésem?',
        summary: 'Rendelés-státusz.',
      },
      {} as any,
    );

    expect(create).toHaveBeenCalledOnce();
    expect(out).toMatchObject({ escalated: true, ticketId: 'esc_test' });
    expect(JSON.stringify(out)).toContain('kollég');
  });

  it('a modell által adott reason-t továbbadja a sinknek', async () => {
    const create = vi.fn((): EscalationTicket =>
      fakeTicket({ reason: 'no_grounding' }),
    );
    const sink: EscalationSink = { create };

    const tool = buildEscalateToHuman(sink);
    await tool.execute!(
      {
        reason: 'no_grounding',
        customerMessage: 'Ehető a szobapálma?',
        summary: 'Nincs fedő forrás a tudásbázisban.',
      },
      {} as any,
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'no_grounding' }),
    );
  });

  // Az execute SOSEM dobhat (üres tool_result → Anthropic 400). Ha a sink dob (pl. FS-hiba),
  // beszédes, NEM üres hibaszöveget ad vissza — nem reject-el.
  it('ha a sink dob, beszédes hibaszöveget ad vissza (nem reject)', async () => {
    const sink: EscalationSink = {
      create: () => {
        throw new Error('nem írható a tickets mappa');
      },
    };

    const tool = buildEscalateToHuman(sink);
    const out = await tool.execute!(
      { reason: 'ambiguous', customerMessage: 'x', summary: 'y' },
      {} as any,
    );

    expect(typeof out).toBe('string');
    expect(out as string).toContain('Hiba');
    expect(out as string).toContain('nem írható');
  });
});
