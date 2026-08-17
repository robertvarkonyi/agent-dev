// Plantbase CLI — belépési pont (B2: LLM, adatbázis nélkül).
// `ask <kérdés>` egyszeri lekérdezés + interaktív readline mód (kilépés: exit).
// Az agent LLM-mel válaszol; adat-kérdésnél őszintén jelzi, hogy nincs DB-hozzáférése.
// A B3 fázis köti be a runSql toolt.
import 'dotenv/config';
import { Command } from 'commander';
import { createInterface } from 'node:readline';
import { createInterface as createRlPromises } from 'node:readline/promises';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  askAgent,
  buildPrompt,
  streamChat,
  SYSTEM_PROMPT,
  CUSTOMER_SYSTEM_PROMPT,
  appendEscalationEvent,
  readEscalationEvents,
  foldTickets,
  type ChatMessage,
  type Prompt,
  type EscalationSink,
  type EscalationInput,
  type EscalationTicket,
  type EscalationReason,
  type ResolutionAction,
} from '@plantbase/core';
import {
  loadRagConfig,
  createProviders,
  PgStore,
  ingestDocs,
  runGolden,
  renderGoldenMarkdown,
  GOLDEN_QUESTIONS,
  UsageTracker,
  type IngestProgress,
  type GoldenProgress,
} from '@plantbase/rag';
import { formatTokenBreakdown, formatProviderUsage } from './token-report.js';

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

    const { answer: text, tokenBreakdown } = await askAgent(input);
    console.log(text);
    console.log(formatTokenBreakdown(tokenBreakdown));
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
      const { messages, tokenBreakdown } = await done;
      console.log(formatTokenBreakdown(tokenBreakdown));
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
  const usage = new UsageTracker();

  try {
    const files = readdirSync(KNOWLEDGE_DIR)
      .filter((name) => name.endsWith('.md'))
      .map((name) => ({
        docId: name.slice(0, -3),
        raw: readFileSync(join(KNOWLEDGE_DIR, name), 'utf8'),
      }));

    console.log(
      `Indexelés indul: ${files.length} dokumentum a(z) ${KNOWLEDGE_DIR}/ mappából (modell: ${cfg.embedModel})…`,
    );

    const onProgress = (e: IngestProgress): void => {
      if (e.type === 'deleted') {
        console.log(`  törölve (már nincs fájl): ${e.docId}`);

        return;
      }

      const status =
        e.action === 'indexed'
          ? `indexelve (${e.chunks} chunk)`
          : 'változatlan (kihagyva)';

      console.log(`  [${e.index}/${e.total}] ${e.docId} — ${status}`);
    };

    const deps = {
      providers: createProviders(cfg, usage),
      store: new PgStore(pool),
      embedModel: cfg.embedModel,
      onProgress,
    };

    const result = await ingestDocs(files, deps);
    console.log(
      `\nKész. Indexelve: ${result.indexed}, kihagyva (nincs változás): ${result.skipped}, törölve (már nincs fájl): ${result.deleted}`,
    );
    console.log(formatProviderUsage(usage.snapshot(), usage.totalTokens()));
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
  const usage = new UsageTracker();

  try {
    console.log(
      `Golden-set futtatása (raw vs full): ${GOLDEN_QUESTIONS.length} kérdés…`,
    );

    const onProgress = (e: GoldenProgress): void => {
      if (e.type === 'question-start') {
        console.log(`\n[${e.index}/${e.total}] ${e.q}`);

        return;
      }

      if (e.step === 'grounded') {
        console.log(`  grounded: ${e.grounded ? 'igen' : 'NINCS'}`);

        return;
      }

      console.log(`  ${e.step} kész (${e.results} találat)`);
    };

    const deps = {
      providers: createProviders(cfg, usage),
      store: new PgStore(pool),
      onProgress,
    };

    const report = await runGolden(deps, {
      topN: cfg.topN,
      topK: cfg.topK,
      minRerankScore: cfg.minRerankScore,
    });

    writeFileSync(GOLDEN_SET_PATH, renderGoldenMarkdown(report));

    // Összegzés: hány megválaszolható kérdésnél rendezte át a rerank a #1 találatot, és hány
    // kérdés viselkedett grounding-szempontból az elvárt módon (a negatív próbát is beleértve).
    const reordered = report.rows.filter(
      (r) => r.expectAnswerable && r.full[0]?.docId !== r.raw[0]?.docId,
    ).length;

    const groundingOk = report.rows.filter(
      (r) => r.grounded === r.expectAnswerable,
    ).length;

    console.log(
      `Kész: ${GOLDEN_SET_PATH} frissítve (${report.rows.length} kérdés).`,
    );
    console.log(
      `  Rerank átrendezte a #1-et: ${reordered} kérdésnél. Grounding az elvárt módon: ${groundingOk}/${report.rows.length}.`,
    );
    console.log(formatProviderUsage(usage.snapshot(), usage.totalTokens()));
  } finally {
    await pool.end();
  }
}

// ---------------------------------------------------------------------------
// HF5 — ügyfélirányú PoC: ügyfélsegéd (`segit`) + eszkalációs jegysor (`sor`).
// ---------------------------------------------------------------------------

const TICKETS_DIR = 'tickets';

// Ember-olvasható címkék a soron és a handoffon (a queue kód-kulcsaihoz).
const REASON_LABEL: Record<EscalationReason, string> = {
  out_of_scope: 'hatókörön kívüli (rendelés/panasz/fizetés/garancia)',
  no_grounding: 'nincs fedő forrás a tudásbázisban',
  ambiguous: 'kétértelmű kérés (tisztázás után is)',
  commitment: 'kereskedelmi elköteleződés (félretétel/kedvezmény)',
  human_requested: 'a vásárló kifejezetten embert kért',
};

const ACTION_LABEL: Record<ResolutionAction, string> = {
  approved: 'jóváhagyva — ember átvette',
  rejected: 'visszavonva — vissza az AI-nak',
  answered: 'kolléga válaszolt a vásárlónak',
};

// Fájl-alapú EscalationSink: a jegysorba ír (append-only JSONL, TICKETS_DIR), és a fordulóban
// létrejött jegyeket gyűjti, hogy a session utána lefuttathassa az emberi handoffot. NEM ír DB-be —
// az agent runSql-je read-only marad (a két DB-jog és a SELECT-guard sértetlen).
class FileEscalationSink implements EscalationSink {
  private readonly justCreated: EscalationTicket[] = [];

  create(input: EscalationInput): EscalationTicket {
    const ticket: EscalationTicket = {
      ...input,
      ticketId: `esc_${randomUUID().slice(0, 8)}`,
      ts: new Date().toISOString(),
      status: 'open',
    };

    appendEscalationEvent(
      {
        type: 'created',
        ticketId: ticket.ticketId,
        ts: ticket.ts,
        reason: ticket.reason,
        customerMessage: ticket.customerMessage,
        summary: ticket.summary,
        triedTools: ticket.triedTools,
      },
      TICKETS_DIR,
    );

    this.justCreated.push(ticket);

    return ticket;
  }

  // A fordulóban létrejött jegyeket kiadja (és üríti) — ezekre fut a handoff.
  drain(): EscalationTicket[] {
    return this.justCreated.splice(0, this.justCreated.length);
  }

  // A kolléga döntését `resolved` eseményként a sorba írja (audit + a `sor` innen olvassa).
  resolve(
    ticketId: string,
    action: ResolutionAction,
    by: string,
    note?: string,
  ): void {
    appendEscalationEvent(
      {
        type: 'resolved',
        ticketId,
        ts: new Date().toISOString(),
        action,
        by,
        note,
      },
      TICKETS_DIR,
    );
  }
}

// Egy sort kér a readline-tól; ha a bemenet lezárult (EOF / Ctrl-D / pipe vége), null-t ad —
// így a piped/scriptelt demó tisztán kilép, nem dob „readline was closed" hibát.
async function promptLine(
  rl: ReturnType<typeof createRlPromises>,
  question: string,
): Promise<string | null> {
  try {
    return await rl.question(question);
  } catch {
    return null;
  }
}

// Emberi jóváhagyási pont: az eszkalált jegy teljes kontextusát kiírja, majd a kolléga dönt.
// Ez a demó „az eszkaláció tényleg embert hív" része — élő, begépelt emberi döntés.
async function handleHandoff(
  rl: ReturnType<typeof createRlPromises>,
  sink: FileEscalationSink,
  ticket: EscalationTicket,
): Promise<void> {
  console.log('\n────────────────────────────────────────────────────────');
  console.log('🔔 ESZKALÁCIÓ — emberi jóváhagyás szükséges');
  console.log(`   Jegy:            ${ticket.ticketId}`);
  console.log(`   Ok:              ${REASON_LABEL[ticket.reason]}`);
  console.log(`   Vásárló kérdése: „${ticket.customerMessage}"`);
  console.log(`   AI összefoglaló: ${ticket.summary}`);

  if (ticket.triedTools?.length) {
    console.log(`   Próbált tool-ok: ${ticket.triedTools.join(', ')}`);
  }

  console.log('────────────────────────────────────────────────────────');

  const raw = await promptLine(
    rl,
    'Kolléga döntése — [j]óváhagy+átvesz / [e]lutasít (vissza az AI-nak) / [v]álasz: ',
  );

  // EOF a handoff alatt → alapértelmezés: jóváhagyás (a jegy semmiképp ne maradjon nyitva „félúton").
  const choice = (raw ?? 'j').trim().toLowerCase();

  if (choice === 'v') {
    const note =
      (await promptLine(rl, '  Írd be a választ a vásárlónak: ')) ?? '';

    sink.resolve(ticket.ticketId, 'answered', 'operator', note.trim());
    console.log(`✅ Válasz naplózva, jegy ${ticket.ticketId} lezárva.\n`);

    return;
  }

  if (choice === 'e') {
    const note =
      (await promptLine(rl, '  Indoklás (miért nem kell ember?): ')) ?? '';

    sink.resolve(ticket.ticketId, 'rejected', 'operator', note.trim());
    console.log(
      `↩️  Eszkaláció visszavonva, jegy ${ticket.ticketId} lezárva.\n`,
    );

    return;
  }

  sink.resolve(ticket.ticketId, 'approved', 'operator');
  console.log(`✅ Ember átvette, jegy ${ticket.ticketId} lezárva.\n`);
}

// `segit` — vásárlói (ügyfélirányú) session: 24/7 önkiszolgáló válasz + bizonytalanságnál eszkaláció.
async function runCustomerAssist(): Promise<void> {
  const rl = createRlPromises({ input: process.stdin, output: process.stdout });
  const sink = new FileEscalationSink();
  const history: ChatMessage[] = [];

  console.log(
    '🌱 Plantbase ügyfélsegéd — AI-asszisztenssel beszélsz (nem élő ügyintéző).',
  );
  console.log(
    '   Kérdezz növényről, árról, készletről, gondozásról. Kilépés: exit\n',
  );

  try {
    for (;;) {
      const raw = await promptLine(rl, 'te> ');

      if (raw === null) {
        break; // stdin lezárult (EOF / Ctrl-D / pipe vége) — tiszta kilépés
      }

      const line = raw.trim();

      if (line === 'exit' || line === 'quit') {
        break;
      }

      if (line.length === 0) {
        continue;
      }

      const next: ChatMessage[] = [...history, { role: 'user', content: line }];
      const { textStream, done } = streamChat(
        next,
        undefined,
        CUSTOMER_SYSTEM_PROMPT,
        sink,
      );

      // A done sosem maradhat kezeletlen (stream-hiba → a for-await a catch-be ugrik).
      done.catch(() => undefined);

      process.stdout.write('segéd> ');

      try {
        for await (const chunk of textStream) {
          process.stdout.write(chunk);
        }

        process.stdout.write('\n');

        const { messages, tokenBreakdown } = await done;
        console.log(formatTokenBreakdown(tokenBreakdown));
        history.splice(0, history.length, ...messages);
      } catch (error) {
        console.error(
          `Hiba: ${error instanceof Error ? error.message : String(error)}`,
        );

        continue;
      }

      // Ha a forduló eszkalált, jön az emberi handoff (egy vagy több jegyre).
      for (const ticket of sink.drain()) {
        await handleHandoff(rl, sink, ticket);
      }
    }
  } finally {
    rl.close();
  }

  console.log('Viszlát!');
}

// `sor` — az eszkalációs jegysor read-only nézete (audit + a mérési terv adatforrása).
function showQueue(): void {
  const tickets = foldTickets(readEscalationEvents(TICKETS_DIR));

  if (tickets.length === 0) {
    console.log('A jegysor üres (nincs eszkaláció).');

    return;
  }

  const open = tickets.filter((t) => t.status === 'open');
  const resolved = tickets.filter((t) => t.status === 'resolved');

  console.log(
    `Eszkalációs jegysor: ${tickets.length} összes · ${open.length} nyitott · ${resolved.length} lezárt`,
  );

  const byReason = new Map<EscalationReason, number>();

  for (const t of tickets) {
    byReason.set(t.reason, (byReason.get(t.reason) ?? 0) + 1);
  }

  console.log('\nOk szerint:');

  for (const [reason, count] of byReason) {
    console.log(`  ${count}×  ${REASON_LABEL[reason]}`);
  }

  console.log('\nJegyek:');

  for (const t of tickets) {
    const badge = t.status === 'open' ? '🟠 NYITOTT' : '🟢 LEZÁRT ';
    console.log(`  ${badge}  ${t.ticketId}  [${REASON_LABEL[t.reason]}]`);
    console.log(`     „${t.customerMessage}"`);

    if (t.resolution) {
      const note = t.resolution.note ? ` — ${t.resolution.note}` : '';
      console.log(
        `     → ${ACTION_LABEL[t.resolution.action]} (${t.resolution.by})${note}`,
      );
    }
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
  .command('segit')
  .description(
    'Ügyfélsegéd — vásárlói session önkiszolgálással és emberi eszkalációval (kilépés: exit)',
  )
  .action(async () => {
    try {
      await runCustomerAssist();
    } catch (error) {
      console.error(
        `Hiba (segit): ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    }
  });

program
  .command('sor')
  .description(
    'Az eszkalációs jegysor megjelenítése (nyitott/lezárt jegyek, ok szerint)',
  )
  .action(() => {
    showQueue();
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
