import { describe, it, expect, vi, beforeEach } from 'vitest';

// A naplózást elkapjuk (az invariáns: minden interakció naplózódik).
const logSpy = vi.fn();
vi.mock('./logger.js', () => ({ logInteraction: (...a: unknown[]) => logSpy(...a) }));

// A DB-t mockoljuk, hogy a tool-execute hálózat nélkül fusson.
vi.mock('./run-sql.js', () => ({
  runSql: vi.fn(async (q: string) => ({ sql: q.trim(), rows: [{ n: 1 }], rowCount: 1 })),
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

import { askAgent, buildPrompt, streamChat } from './ask-agent.js';
import { SYSTEM_PROMPT } from './system-prompt.js';

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
      usage: { inputTokens: 10, outputTokens: 5 },
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
      response: { messages: [{ role: 'assistant', content: 'Kész.' }] },
    });
    const res = await askAgent('szia', {} as never);
    expect(res.usage).toEqual({ input_tokens: 0, output_tokens: 0 });
  });

  it('naplózza az interakciót, benne a collector SQL-jével', async () => {
    // A stubolt generateText lefuttatja a runSql toolt, hogy a collector megteljen.
    generateTextMock.mockImplementation(
      async (opts: { tools: ReturnType<typeof import('./agent-tools.js').buildTools> }) => {
        await opts.tools.runSql.execute!(
          { query: 'SELECT * FROM products' },
          { toolCallId: 't', messages: [] } as never,
        );
        return {
          text: 'Egy termék.',
          usage: { inputTokens: 1, outputTokens: 1 },
          response: { messages: [{ role: 'assistant', content: 'Egy termék.' }] },
        };
      },
    );
    await askAgent('mutass egy terméket', {} as never);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const entry = logSpy.mock.calls[0][0] as { sql: string; answer: string };
    expect(entry.sql).toContain('SELECT * FROM products');
    expect(entry.answer).toBe('Egy termék.');
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
        usage: Promise.resolve({ inputTokens: 3, outputTokens: 2 }),
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
