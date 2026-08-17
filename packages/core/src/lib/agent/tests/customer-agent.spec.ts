import { describe, it, expect, vi, beforeEach } from 'vitest';

// A naplózást elkapjuk (az invariáns: minden interakció — az eszkaláció is — naplózódik).
const logSpy = vi.fn();
vi.mock('../../shared/logger.js', () => ({
  logInteraction: (...a: unknown[]) => logSpy(...a),
}));

// Az 'ai' generateText-jét stuboljuk, hogy hálózat nélkül, determinisztikusan hajtsuk a tool-okat.
const generateTextMock = vi.fn();
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();

  return {
    ...actual,
    generateText: (...a: unknown[]) => generateTextMock(...a),
  };
});

import { askAgent } from '../ask-agent.js';
import { CUSTOMER_SYSTEM_PROMPT } from '../customer-system-prompt.js';
import type { EscalationSink } from '../../tools/escalate-to-human.js';
import type {
  EscalationInput,
  EscalationTicket,
} from '../../shared/escalation-queue.js';

function memorySink(): {
  sink: EscalationSink;
  created: EscalationTicket[];
} {
  const created: EscalationTicket[] = [];

  const sink: EscalationSink = {
    create: vi.fn((input: EscalationInput): EscalationTicket => {
      const ticket: EscalationTicket = {
        ...input,
        ticketId: 'esc_x',
        ts: '2026-08-17T10:00:00.000Z',
        status: 'open',
      };

      created.push(ticket);

      return ticket;
    }),
  };

  return { sink, created };
}

type GenTextOpts = {
  tools: ReturnType<typeof import('../../tools/agent-tools.js').buildTools>;
};

const okResponse = {
  text: 'ok',
  usage: { inputTokens: 1, outputTokens: 1 },
  totalUsage: { inputTokens: 1, outputTokens: 1 },
  response: { messages: [{ role: 'assistant', content: 'ok' }] },
};

describe('ügyfélirányú askAgent — eszkaláció', () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    logSpy.mockReset();
  });

  it('escalateSink NÉLKÜL nincs escalateToHuman tool (visszafelé kompatibilis)', async () => {
    let hasEscalate = true;

    generateTextMock.mockImplementation(async (opts: GenTextOpts) => {
      hasEscalate = 'escalateToHuman' in opts.tools;

      return okResponse;
    });

    await askAgent('szia', {} as never, CUSTOMER_SYSTEM_PROMPT);

    expect(hasEscalate).toBe(false);
  });

  it('escalateSink esetén az escalateToHuman a sinken jegyet hoz létre és naplózódik', async () => {
    const { sink, created } = memorySink();

    generateTextMock.mockImplementation(async (opts: GenTextOpts) => {
      await opts.tools.escalateToHuman.execute!(
        {
          reason: 'out_of_scope',
          customerMessage: 'Hol tart a rendelésem?',
          summary: 'Rendelés-státusz — nincs rá adat, ember kell.',
        },
        { toolCallId: 't', messages: [] } as never,
      );

      return okResponse;
    });

    await askAgent(
      'Hol tart a rendelésem?',
      {} as never,
      CUSTOMER_SYSTEM_PROMPT,
      sink,
    );

    expect(sink.create).toHaveBeenCalledOnce();
    expect(created[0].reason).toBe('out_of_scope');

    // Az eszkaláció a naplóba is bekerül (audit): a collector SQL-mezője escalateToHuman:<reason>.
    const entry = logSpy.mock.calls[0][0] as { sql: string };
    expect(entry.sql).toContain('escalateToHuman:out_of_scope');
  });
});
