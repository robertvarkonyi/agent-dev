import { describe, it, expect, vi, beforeEach } from 'vitest';

// A naplózást elkapjuk (nincs valódi fájlírás; az audit-invariánst is ellenőrizzük).
const logSpy = vi.fn();
vi.mock('../../shared/logger.js', () => ({
  logInteraction: (...a: unknown[]) => logSpy(...a),
}));

// Az 'ai' generateText-jét stuboljuk; a tool()/stepCountIs valódi marad, így a buildTools által
// felépített escalateToHuman toolt ÉLESBEN hívjuk — csak a modell-lépést mockoljuk (hálózat nélkül).
const generateTextMock = vi.fn();
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();

  return {
    ...actual,
    generateText: (...a: unknown[]) => generateTextMock(...a),
    streamText: vi.fn(),
  };
});

import { askAgent } from '../ask-agent.js';
import { CUSTOMER_SYSTEM_PROMPT } from '../customer-system-prompt.js';
import type { EscalationSink } from '../../tools/escalate-to-human.js';
import type {
  EscalationInput,
  EscalationTicket,
} from '../../shared/escalation-queue.js';

// Rögzítő sink: a tool által létrehozott jegyeket memóriában gyűjti (nincs fájlírás).
function recordingSink(): { sink: EscalationSink; created: EscalationInput[] } {
  const created: EscalationInput[] = [];

  const sink: EscalationSink = {
    create: (input: EscalationInput): EscalationTicket => {
      created.push(input);

      return {
        ...input,
        ticketId: 'esc_fake',
        ts: '2026-08-17T00:00:00.000Z',
        status: 'open',
      };
    },
  };

  return { sink, created };
}

describe('vásárlói agent — eszkaláció-routing (determinisztikus, hálózat nélkül)', () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    logSpy.mockReset();
  });

  it('sinkkel: az escalateToHuman jegyet ír a sinkre, és az audit a naplóba kerül', async () => {
    const { sink, created } = recordingSink();

    // A mockolt modell a hatókörön kívüli kérdésre az escalateToHuman toolt hívja.
    generateTextMock.mockImplementation(
      async (opts: {
        tools: ReturnType<
          typeof import('../../tools/agent-tools.js').buildTools
        >;
      }) => {
        await opts.tools.escalateToHuman!.execute!(
          {
            reason: 'out_of_scope',
            customerMessage: 'hol tart a rendelésem?',
            summary: 'Rendelés-státusz — nincs rá adat, ember kell.',
            triedTools: [],
          },
          { toolCallId: 't', messages: [] } as never,
        );

        return {
          text: 'Továbbítottam egy kollégának.',
          usage: { inputTokens: 1, outputTokens: 1 },
          totalUsage: { inputTokens: 1, outputTokens: 1 },
          response: {
            messages: [
              { role: 'assistant', content: 'Továbbítottam egy kollégának.' },
            ],
          },
        };
      },
    );

    const res = await askAgent(
      'hol tart a rendelésem?',
      {} as never,
      CUSTOMER_SYSTEM_PROMPT,
      sink,
    );

    // A tool a sinkre írt, a helyes okkal.
    expect(created).toHaveLength(1);
    expect(created[0].reason).toBe('out_of_scope');
    expect(res.answer).toContain('kollég');

    // Az eszkaláció auditáltan a naplóba kerül (escalateToHuman:<reason> az sql-mezőben),
    // és a VÁSÁRLÓI system prompt naplózódik (nem a belső designer-prompt).
    expect(logSpy).toHaveBeenCalledTimes(1);
    const entry = logSpy.mock.calls[0][0] as { sql: string; system: string };
    expect(entry.sql).toContain('escalateToHuman:out_of_scope');
    expect(entry.system).toBe(CUSTOMER_SYSTEM_PROMPT);
  });

  it('sink nélkül a customer-úton NINCS escalateToHuman tool (a designer tool-készlet marad)', async () => {
    let toolNames: string[] = [];

    generateTextMock.mockImplementation(
      async (opts: { tools: Record<string, unknown> }) => {
        toolNames = Object.keys(opts.tools);

        return {
          text: 'ok',
          usage: { inputTokens: 1, outputTokens: 1 },
          totalUsage: { inputTokens: 1, outputTokens: 1 },
          response: { messages: [{ role: 'assistant', content: 'ok' }] },
        };
      },
    );

    await askAgent('szia', {} as never, CUSTOMER_SYSTEM_PROMPT);

    expect(toolNames).toContain('runSql');
    expect(toolNames).not.toContain('escalateToHuman');
  });
});
