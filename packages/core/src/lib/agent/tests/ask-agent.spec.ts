import { describe, it, expect, vi, beforeEach } from 'vitest';

// A naplózást elkapjuk (az invariáns: minden interakció naplózódik).
const logSpy = vi.fn();
vi.mock('../../shared/logger.js', () => ({
  logInteraction: (...a: unknown[]) => logSpy(...a),
}));

// A DB-t mockoljuk, hogy a tool-execute hálózat nélkül fusson.
vi.mock('../../tools/run-sql.js', () => ({
  runSql: vi.fn(async (q: string) => ({
    sql: q.trim(),
    rows: [{ n: 1 }],
    rowCount: 1,
  })),
}));

// Az 'ai'-ból a generateText-et és a streamText-et stuboljuk; a tool()/stepCountIs valódi marad.
const generateTextMock = vi.fn();
const streamTextMock = vi.fn();
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    generateText: (...a: unknown[]) => generateTextMock(...a),
    streamText: (...a: unknown[]) => streamTextMock(...a),
  };
});

import { askAgent, buildPrompt, streamChat } from '../ask-agent.js';
import { SYSTEM_PROMPT } from '../system-prompt.js';

describe('buildPrompt', () => {
  it('a system promptot és a user üzenetet adja vissza', () => {
    const prompt = buildPrompt('szia');
    expect(prompt.system).toBe(SYSTEM_PROMPT);
    expect(prompt.messages).toEqual([{ role: 'user', content: 'szia' }]);
  });

  it('trimmeli a kérdést', () => {
    expect(buildPrompt('  szia  ').messages[0].content).toBe('szia');
  });

  it('hibát dob üres kérdésre', () => {
    expect(() => buildPrompt('   ')).toThrow();
  });
});

describe('askAgent', () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    logSpy.mockReset();
  });

  it('a modell szövegét adja vissza és a usage-t {input_tokens,output_tokens}-re képezi', async () => {
    generateTextMock.mockResolvedValue({
      text: 'Kész.',
      // usage csak az utolsó lépésé; a naplózott/ visszaadott usage-nek a totalUsage-ből kell
      // jönnie (összes lépés összesítve) — a két érték szándékosan eltér, hogy az assert
      // megkülönböztesse a kettőt.
      usage: { inputTokens: 99, outputTokens: 99 },
      totalUsage: { inputTokens: 10, outputTokens: 5 },
      response: { messages: [{ role: 'assistant', content: 'Kész.' }] },
    });
    const res = await askAgent('szia', {} as never);
    expect(res.answer).toBe('Kész.');
    expect(res.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
  });

  it('a usage-t nullázza, ha a modell nem ad usage-t', async () => {
    generateTextMock.mockResolvedValue({
      text: 'Kész.',
      usage: undefined,
      totalUsage: undefined,
      response: { messages: [{ role: 'assistant', content: 'Kész.' }] },
    });
    const res = await askAgent('szia', {} as never);
    expect(res.usage).toEqual({ input_tokens: 0, output_tokens: 0 });
  });

  it('naplózza az interakciót, benne a collector SQL-jével és a user kérdéssel', async () => {
    // A stubolt generateText lefuttatja a runSql toolt, hogy a collector megteljen.
    generateTextMock.mockImplementation(
      async (opts: {
        tools: ReturnType<typeof import('../../tools/agent-tools.js').buildTools>;
      }) => {
        await opts.tools.runSql.execute!({ query: 'SELECT * FROM products' }, {
          toolCallId: 't',
          messages: [],
        } as never);
        return {
          text: 'Egy termék.',
          usage: { inputTokens: 1, outputTokens: 1 },
          totalUsage: { inputTokens: 1, outputTokens: 1 },
          response: {
            messages: [{ role: 'assistant', content: 'Egy termék.' }],
          },
        };
      },
    );
    await askAgent('mutass egy terméket', {} as never);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const entry = logSpy.mock.calls[0][0] as {
      sql: string;
      answer: string;
      messages: unknown[];
    };
    expect(entry.sql).toContain('SELECT * FROM products');
    expect(entry.answer).toBe('Egy termék.');
    // A naplózott messages-nek tartalmaznia kell a user kérdését is, nem csak az asszisztens
    // válaszát (response.messages önmagában csak asszisztens/tool üzeneteket ad vissza).
    expect(entry.messages[0]).toEqual({
      role: 'user',
      content: 'mutass egy terméket',
    });
  });
});

describe('streamChat', () => {
  beforeEach(() => {
    streamTextMock.mockReset();
    logSpy.mockReset();
  });

  it('streameli a szöveget, és a done a frissített előzményt + usage-t adja', async () => {
    streamTextMock.mockImplementation(() => {
      async function* gen() {
        yield 'Hel';
        yield 'ló';
      }
      return {
        textStream: gen(),
        text: Promise.resolve('Helló'),
        // usage csak az utolsó lépésé; a totalUsage-nek kell érvényesülnie — a két érték
        // szándékosan eltér, hogy az assert megkülönböztesse a kettőt.
        usage: Promise.resolve({ inputTokens: 99, outputTokens: 99 }),
        totalUsage: Promise.resolve({ inputTokens: 3, outputTokens: 2 }),
        response: Promise.resolve({
          messages: [{ role: 'assistant', content: 'Helló' }],
        }),
      };
    });

    const history = [{ role: 'user' as const, content: 'szia' }];
    const { textStream, done } = streamChat(history, {} as never);

    let acc = '';
    for await (const chunk of textStream) acc += chunk;
    expect(acc).toBe('Helló');

    const result = await done;
    expect(result.answer).toBe('Helló');
    expect(result.usage).toEqual({ input_tokens: 3, output_tokens: 2 });
    expect(result.messages).toEqual([
      { role: 'user', content: 'szia' },
      { role: 'assistant', content: 'Helló' },
    ]);
    expect(logSpy).toHaveBeenCalledTimes(1);
  });
});
