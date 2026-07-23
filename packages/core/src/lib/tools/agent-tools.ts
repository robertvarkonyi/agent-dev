import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { Pool } from 'pg';
import {
  loadRagConfig,
  createProviders,
  PgStore,
  answerFromKnowledge,
  type UsageTracker,
} from '@plantbase/rag';
import { errorMessage } from '../shared/errors.js';
import { runSql } from './run-sql.js';
import { listCategories, CATEGORIES_SQL } from './list-categories.js';
import { buildSearchKnowledge, type AnswerFn } from './search-knowledge.js';

// Egy tool-hívás naplózandó nyoma: a ténylegesen futott SQL + a modellnek adott sorok.
export interface ToolCall {
  sql: string;
  rows: unknown;
}

// A modell által olvasható, NEM üres hibaszöveg. Fontos: az execute SOSEM dobhat — a dobott
// Error az AI SDK-ban üres tool_result-tá szerializálódik (JSON.stringify(Error) === '{}'),
// amit az Anthropic 400-zal elutasít (is_error + üres content). A visszaadott szöveget a modell
// olvassa, és a system prompt szerint javított lekérdezéssel újrapróbál.
function toolError(error: unknown): string {
  return `Hiba: ${errorMessage(error)}`;
}

// Lazy singleton Pool a READ-ONLY kapcsolaton (run-sql.ts mintájára) — a searchKnowledge is csak
// olvas, a DATABASE_URL (RW/owner) itt SOSEM használható. Az ingestion (Task 10 CLI) az egyetlen író.
let ragPool: Pool | undefined;

// Éles AnswerFn-gyár: opcionálisan kap egy kérés-hatókörű UsageTracker-t, amit a RAG-providerekbe
// fűz (createProviders 2. arg) — így a searchKnowledge alatti embed/HyDE/rerank/answer tokenek is
// ugyanabba a trackerbe gyűlnek, mint az orchestrátoré. A config + PgStore minden híváskor friss,
// csak a READ-ONLY Pool singleton.
function makeLiveAnswer(tracker?: UsageTracker): AnswerFn {
  return (query: string) => {
    const cfg = loadRagConfig();

    if (!ragPool) {
      const connectionString = process.env.DATABASE_URL_READONLY;

      if (!connectionString) {
        throw new Error(
          'Hiányzik a DATABASE_URL_READONLY. Állítsd be a .env-ben.',
        );
      }

      ragPool = new Pool({ connectionString });
    }

    const deps = {
      providers: createProviders(cfg, tracker),
      store: new PgStore(ragPool),
    };

    return answerFromKnowledge(query, deps, {
      topN: cfg.topN,
      topK: cfg.topK,
      minRerankScore: cfg.minRerankScore,
    });
  };
}

// A tool-ok egyetlen helye (ez váltja az inline Anthropic.Tool konstansokat). Új tool = egy
// bejegyzés ide. A `collector` futás-hatókörű: minden execute mellékhatásként belépteti a
// naplózandó { sql, rows }-t, miközben a modellnek csak a rows megy vissza.
export function buildTools(
  collector: ToolCall[],
  tracker?: UsageTracker,
): ToolSet {
  return {
    runSql: tool({
      description:
        'Read-only SQL (SELECT) futtatása a products katalóguson. A generált SELECT-et mindig ezzel futtasd, majd az eredményből válaszolj.',
      inputSchema: z.object({
        query: z
          .string()
          .describe('A futtatandó SELECT lekérdezés (PostgreSQL).'),
      }),
      execute: async ({ query }) => {
        try {
          const { sql, rows } = await runSql(query);
          collector.push({ sql, rows });

          return rows;
        } catch (error) {
          return toolError(error);
        }
      },
    }),

    listCategories: tool({
      description:
        'A katalógus egyedi (distinct) kategóriáinak listája. Akkor hívd, ha a felhasználó a kategóriákra kérdez rá — ne generálj hozzá SQL-t.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const categories = await listCategories();
          collector.push({ sql: CATEGORIES_SQL, rows: categories });

          return categories;
        } catch (error) {
          return toolError(error);
        }
      },
    }),

    searchKnowledge: buildSearchKnowledge(makeLiveAnswer(tracker)),
  };
}
