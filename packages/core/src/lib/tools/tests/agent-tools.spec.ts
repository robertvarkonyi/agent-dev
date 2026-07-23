import { describe, it, expect, vi } from 'vitest';

vi.mock('../run-sql.js', () => ({
  runSql: vi.fn(async (q: string) => ({ sql: q.trim(), rows: [{ id: 1 }], rowCount: 1 })),
}));
vi.mock('../list-categories.js', () => ({
  CATEGORIES_SQL: 'SELECT DISTINCT category FROM products ORDER BY category',
  listCategories: vi.fn(async () => ['kaktusz', 'pozsgás']),
}));

import { buildTools, type ToolCall } from '../agent-tools.js';
import { runSql } from '../run-sql.js';
import { listCategories } from '../list-categories.js';

// Az AI SDK execute második paramétere a ToolCallOptions — a tesztben minimál stub elég.
const opts = { toolCallId: 't1', messages: [] } as never;

describe('buildTools', () => {
  it('a runSql execute a collectorba tolja az SQL-t és a sorokat adja vissza', async () => {
    const collector: ToolCall[] = [];
    const tools = buildTools(collector);
    const rows = await tools.runSql.execute!({ query: 'SELECT * FROM products' }, opts);
    expect(rows).toEqual([{ id: 1 }]);
    expect(collector).toEqual([{ sql: 'SELECT * FROM products', rows: [{ id: 1 }] }]);
  });

  it('a listCategories execute a fix SQL-t naplózza és a kategóriákat adja vissza', async () => {
    const collector: ToolCall[] = [];
    const tools = buildTools(collector);
    const cats = await tools.listCategories.execute!({}, opts);
    expect(cats).toEqual(['kaktusz', 'pozsgás']);
    expect(collector[0]?.sql).toContain('DISTINCT category');
  });

  // Hiba esetén az execute NEM dobhat: a dobott Error az AI SDK-ban üres tool_result-tá
  // szerializálódik (JSON.stringify(Error) === '{}'), amit az Anthropic 400-zal elutasít
  // (is_error + üres content). Helyette beszédes hibaszöveget adunk vissza, amit a modell olvas
  // és a system prompt szerint újrapróbál.
  it('a runSql execute hibánál beszédes hibaszöveget ad vissza (nem dob), és nem naplóz', async () => {
    vi.mocked(runSql).mockRejectedValueOnce(
      new Error('Csak SELECT (vagy WITH ... SELECT) lekérdezés engedélyezett.'),
    );
    const collector: ToolCall[] = [];
    const tools = buildTools(collector);
    const result = await tools.runSql.execute!({ query: 'DROP TABLE products' }, opts);
    expect(typeof result).toBe('string');
    expect(result as string).toContain('Csak SELECT');
    expect((result as string).length).toBeGreaterThan(0);
    expect(collector).toEqual([]);
  });

  it('a listCategories execute hibánál beszédes hibaszöveget ad vissza (nem dob)', async () => {
    vi.mocked(listCategories).mockRejectedValueOnce(new Error('DB nem elérhető.'));
    const collector: ToolCall[] = [];
    const tools = buildTools(collector);
    const result = await tools.listCategories.execute!({}, opts);
    expect(typeof result).toBe('string');
    expect(result as string).toContain('DB nem elérhető.');
    expect(collector).toEqual([]);
  });
});
