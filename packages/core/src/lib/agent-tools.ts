import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { runSql } from './run-sql.js';
import { listCategories, CATEGORIES_SQL } from './list-categories.js';

// Egy tool-hívás naplózandó nyoma: a ténylegesen futott SQL + a modellnek adott sorok.
export interface ToolCall {
  sql: string;
  rows: unknown;
}

// A tool-ok egyetlen helye (ez váltja az inline Anthropic.Tool konstansokat). Új tool = egy
// bejegyzés ide. A `collector` futás-hatókörű: minden execute mellékhatásként belépteti a
// naplózandó { sql, rows }-t, miközben a modellnek csak a rows megy vissza.
export function buildTools(collector: ToolCall[]): ToolSet {
  return {
    runSql: tool({
      description:
        'Read-only SQL (SELECT) futtatása a products katalóguson. A generált SELECT-et mindig ezzel futtasd, majd az eredményből válaszolj.',
      inputSchema: z.object({
        query: z.string().describe('A futtatandó SELECT lekérdezés (PostgreSQL).'),
      }),
      execute: async ({ query }) => {
        const { sql, rows } = await runSql(query);
        collector.push({ sql, rows });
        return rows;
      },
    }),
    listCategories: tool({
      description:
        'A katalógus egyedi (distinct) kategóriáinak listája. Akkor hívd, ha a felhasználó a kategóriákra kérdez rá — ne generálj hozzá SQL-t.',
      inputSchema: z.object({}),
      execute: async () => {
        const categories = await listCategories();
        collector.push({ sql: CATEGORIES_SQL, rows: categories });
        return categories;
      },
    }),
  };
}
