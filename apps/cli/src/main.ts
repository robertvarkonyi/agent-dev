// Plantbase CLI — belépési pont (B2: LLM, adatbázis nélkül).
// `ask <kérdés>` egyszeri lekérdezés + interaktív readline mód (kilépés: exit).
// Az agent LLM-mel válaszol; adat-kérdésnél őszintén jelzi, hogy nincs DB-hozzáférése.
// A B3 fázis köti be a runSql toolt.
import 'dotenv/config';
import { Command } from 'commander';
import { createInterface } from 'node:readline';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import {
  askAgent,
  buildPrompt,
  streamChat,
  SYSTEM_PROMPT,
  type ChatMessage,
  type Prompt,
} from '@plantbase/core';
import {
  loadRagConfig,
  createProviders,
  PgStore,
  ingestDocs,
  runGolden,
  renderGoldenMarkdown,
} from '@plantbase/rag';

function formatPrompt(prompt: Prompt): string {
  return [
    '----- system -----',
    prompt.system,
    '----- messages -----',
    JSON.stringify(prompt.messages, null, 2),
    '------------------',
  ].join('\n');
}

// Egy kérdés feldolgozása: LLM-válasz kiírása, beszédes hibakezeléssel.
async function answer(input: string, showPrompt: boolean): Promise<void> {
  try {
    if (showPrompt) {
      console.log(formatPrompt(buildPrompt(input)));
    }
    const { answer: text } = await askAgent(input);
    console.log(text);
  } catch (error) {
    console.error(
      `Hiba: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function runInteractive(showPrompt: boolean): void {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'plantbase> ',
  });

  // A session alatt élő beszélgetés-előzmény (kilépéskor elveszik — nincs perzisztálás).
  const history: ChatMessage[] = [];
  // A fordulókat sorban dolgozzuk fel: minden sor az előző forduló befejezése után fut,
  // így nincs verseny a közös history-n (egyszerre begépelt/beillesztett sorok is rendben).
  let chain: Promise<void> = Promise.resolve();

  // Egy forduló feldolgozása: a next-et FUTÁSKOR építjük a friss history-ból.
  async function processTurn(text: string): Promise<void> {
    const next: ChatMessage[] = [...history, { role: 'user', content: text }];
    if (showPrompt) {
      console.log(formatPrompt({ system: SYSTEM_PROMPT, messages: next }));
    }
    try {
      const { textStream, done } = streamChat(next);
      // A done sosem maradhat kezeletlen: stream-hiba esetén a for-await a catch-be ugrik,
      // mielőtt az await done lefutna, és a done elutasítása Node-on process-crasht okozna.
      done.catch(() => undefined);
      for await (const chunk of textStream) {
        process.stdout.write(chunk);
      }
      process.stdout.write('\n');
      const { messages } = await done;
      history.splice(0, history.length, ...messages);
    } catch (error) {
      console.error(
        `Hiba: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    rl.prompt();
  }

  console.log('Plantbase interaktív mód. Kilépés: exit');
  rl.prompt();

  rl.on('line', (line) => {
    const text = line.trim();
    if (text === 'exit' || text === 'quit') {
      rl.close();
      return;
    }
    if (text.length === 0) {
      rl.prompt();
      return;
    }
    // Sorba fűzzük; a processTurn hívja a rl.prompt()-ot a végén.
    chain = chain.then(() => processTurn(text));
  });

  rl.on('close', () => {
    console.log('Viszlát!');
    process.exit(0);
  });
}

const KNOWLEDGE_DIR = 'docs/knowledge';
const GOLDEN_SET_PATH = 'docs/RAG/GOLDEN-SET.md';

// rag:index — a docs/knowledge/*.md fájlok (újra)indexelése a tudásbázisba.
// Ez az EGYETLEN író útvonal (ingestion), ezért RW pool (DATABASE_URL) kell —
// nem az agent útvonala, hanem operátori CLI-parancs.
async function ragIndex(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'Hiányzik a DATABASE_URL. Állítsd be a .env-ben (a rag:index írási jogosultságot igényel).',
    );
  }
  const cfg = loadRagConfig();
  const pool = new Pool({ connectionString });
  try {
    const files = readdirSync(KNOWLEDGE_DIR)
      .filter((name) => name.endsWith('.md'))
      .map((name) => ({
        docId: name.slice(0, -3),
        raw: readFileSync(join(KNOWLEDGE_DIR, name), 'utf8'),
      }));
    const deps = {
      providers: createProviders(cfg),
      store: new PgStore(pool),
      embedModel: cfg.embedModel,
    };
    const result = await ingestDocs(files, deps);
    console.log(
      `Indexelve: ${result.indexed}, kihagyva (nincs változás): ${result.skipped}, törölve (már nincs fájl): ${result.deleted}`,
    );
  } finally {
    await pool.end();
  }
}

// rag:golden — a golden-set futtatása (raw vs full pipeline) és a jelentés kiírása.
// Csak OLVAS, ezért RO pool (DATABASE_URL_READONLY) kell.
async function ragGolden(): Promise<void> {
  const connectionString = process.env.DATABASE_URL_READONLY;
  if (!connectionString) {
    throw new Error(
      'Hiányzik a DATABASE_URL_READONLY. Állítsd be a .env-ben (a rag:golden csak olvas).',
    );
  }
  const cfg = loadRagConfig();
  const pool = new Pool({ connectionString });
  try {
    const deps = { providers: createProviders(cfg), store: new PgStore(pool) };
    const report = await runGolden(deps, {
      topN: cfg.topN,
      topK: cfg.topK,
      minRerankScore: cfg.minRerankScore,
    });
    writeFileSync(GOLDEN_SET_PATH, renderGoldenMarkdown(report));
    console.log(
      `Kész: ${GOLDEN_SET_PATH} frissítve (${report.rows.length} kérdés).`,
    );
  } finally {
    await pool.end();
  }
}

const program = new Command();

program
  .name('plantbase')
  .description('Plantbase — növény-katalógus AI asszisztens (CLI)')
  .version('0.0.1')
  .option('--show-prompt', 'a teljes prompt (system + üzenetek) kiírása');

program
  .command('ask')
  .description('Egyszeri kérdés a katalógusról')
  .argument('<kerdes>', 'a természetes nyelvű kérdés')
  .action(async (kerdes: string) => {
    await answer(kerdes, program.opts().showPrompt === true);
  });

program
  .command('chat', { isDefault: true })
  .description('Interaktív mód (kilépés: exit)')
  .action(() => {
    runInteractive(program.opts().showPrompt === true);
  });

program
  .command('rag:index')
  .description(
    `A ${KNOWLEDGE_DIR}/*.md fájlok (újra)indexelése a tudásbázisba (RW, DATABASE_URL)`,
  )
  .action(async () => {
    try {
      await ragIndex();
    } catch (error) {
      console.error(
        `Hiba (rag:index): ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    }
  });

program
  .command('rag:golden')
  .description(
    `Golden-set futtatása (raw vs full) és ${GOLDEN_SET_PATH} generálása (RO, DATABASE_URL_READONLY)`,
  )
  .action(async () => {
    try {
      await ragGolden();
    } catch (error) {
      console.error(
        `Hiba (rag:golden): ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
