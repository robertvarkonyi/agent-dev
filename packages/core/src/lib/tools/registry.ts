import type Anthropic from '@anthropic-ai/sdk';
import { runSql } from './run-sql.js';
import { listCategories, CATEGORIES_SQL } from './list-categories.js';

// Egy agent-tool: a modellnek szóló definíció (JSON Schema input) + a végrehajtó handler.
// A handler visszaadja a naplózandó SQL-t és a modellnek tool_result-ként visszafűzendő sorokat.
export interface AgentTool {
  definition: Anthropic.Tool;
  run(input: unknown): Promise<{ sql: string; rows: unknown }>;
}

const runSqlTool: AgentTool = {
  definition: {
    name: 'runSql',
    description:
      'Read-only SQL (SELECT) futtatása a products katalóguson. A generált SELECT-et mindig ezzel futtasd, majd az eredményből válaszolj.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'A futtatandó SELECT lekérdezés (PostgreSQL).',
        },
      },
      required: ['query'],
    },
  },
  run: async (input) => {
    const result = await runSql((input as { query?: unknown }).query);
    return { sql: result.sql, rows: result.rows };
  },
};

const listCategoriesTool: AgentTool = {
  definition: {
    name: 'listCategories',
    description:
      'A katalógus egyedi (distinct) kategóriáinak listája. Akkor hívd, ha a felhasználó a kategóriákra kérdez rá — ne generálj hozzá SQL-t.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  run: async () => ({ sql: CATEGORIES_SQL, rows: await listCategories() }),
};

// Név → tool regiszter. Új tool bekötése = EGY bejegyzés ide; az agent-loopot nem kell módosítani.
export const TOOLS: Record<string, AgentTool> = {
  [runSqlTool.definition.name]: runSqlTool,
  [listCategoriesTool.definition.name]: listCategoriesTool,
};

// A modellnek átadandó tool-definíciók (a messages.create() `tools` mezőjéhez), a regiszterből.
export const toolDefinitions: Anthropic.Tool[] = Object.values(TOOLS).map(
  (tool) => tool.definition,
);
