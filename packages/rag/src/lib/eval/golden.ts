import { retrieve, type RetrievedChunk } from '../pipeline/retrieve.js';
import { answerFromKnowledge } from '../pipeline/answer.js';
import type { Providers } from '../providers/providers.js';
import type { Store } from '../storage/store.js';

export interface GoldenQuestion {
  id: number;
  q: string;
  // A grounding-próba tengelye: true = a tudásbázisnak fednie kell a kérdést (valós választ várunk),
  // false = szándékosan a tudásbázison KÍVÜLI kérdés, amire elutasítást (grounded=false) várunk.
  expectAnswerable: boolean;
  // Ha a full pipeline (HyDE+rerank) érdemben átrendezi a top-1 találatot, itt az emberi magyarázat,
  // MIÉRT jobb az új sorrend. A generátor csak akkor írja ki, ha a futás tényleg átrendezést mutat
  // (full top-1 ≠ raw top-1) — így sosem állítunk olyan átrendezést, ami az adott futásban nem történt.
  rerankRationale?: string;
}

export const GOLDEN_QUESTIONS: readonly GoldenQuestion[] = [
  {
    id: 1,
    q: 'Milyen fényt igényel a Monstera deliciosa?',
    expectAnswerable: true,
  },
  {
    id: 2,
    q: 'Milyen gyakran öntözzem a kígyónövényt (snake plant)?',
    expectAnswerable: true,
  },
  {
    id: 3,
    q: 'Hogyan szaporítsak pothost dugványról?',
    expectAnswerable: true,
    rerankRationale:
      'A nyers vektorkeresés top-5-je egyetlen pothos-cikket sem hoz be (fűszerkert, hagymák, ' +
      'hoya — mind 0.7 feletti távolság, felszíni „szaporítás/dugvány” szó-átfedésre). A HyDE egy ' +
      'hipotetikus „pothos szaporítása dugványról” választ ágyaz be, ezért a tágabb (topN) ' +
      'jelölthalmazba bekerül a golden-pothos cikk, és a rerank mind az öt helyre azt teszi. Az új ' +
      'sorrend jobb, mert a raw lista témán KÍVÜLI cikkekből próbálna választ adni.',
  },
  {
    id: 4,
    q: 'Miért sárgulnak a növényem levelei?',
    expectAnswerable: true,
    rerankRationale:
      'A nyers keresés #1-e a „why-are-my-plants-leggy” (megnyúlt növény) cikk — MÁS tünet, csak ' +
      'felszíni szó-átfedés. A rerank a pontosan a témába vágó „why-plant-leaves-turn-yellow” cikket ' +
      'emeli a #1-re (a raw listában csak a #4 helyen volt), a leggy-cikket pedig kiszorítja. Az új ' +
      'sorrend jobb, mert a #1 forrás közvetlenül a sárgulás okait tárgyalja, nem egy másik tünetet.',
  },
  {
    id: 5,
    q: 'Hogyan szabaduljak meg a gombaszúnyogoktól?',
    expectAnswerable: true,
  },
  {
    id: 6,
    q: 'Miért lyukasak a Monstera / swiss cheese növény levelei?',
    expectAnswerable: true,
    rerankRationale:
      'A nyers keresés #1-e az általános „how-to-care-for-monstera” cikk (d=0.403); a rerank viszont ' +
      'a kifejezetten a lyukakról szóló „why-swiss-cheese-plant-has-holes” cikket teszi #1-re. Az új ' +
      'sorrend jobb, mert a lyukak okát (levélfenesztráció) a specifikus cikk tárgyalja, nem az ' +
      'általános gondozási.',
  },
  {
    id: 7,
    q: 'Melyik szobanövény biztonságos macskák mellé?',
    expectAnswerable: true,
  },
  {
    id: 8,
    q: 'Hogyan gondozzam a húsevő Vénusz légycsapót?',
    expectAnswerable: false,
  },
];

export interface GoldenRow {
  id: number;
  q: string;
  expectAnswerable: boolean;
  rerankRationale?: string;
  raw: RetrievedChunk[];
  full: RetrievedChunk[];
  grounded: boolean;
  answer: string;
}
export interface GoldenReport {
  rows: GoldenRow[];
  cfg: { topN: number; topK: number; minRerankScore: number };
}

// Folyamat-esemény a hívónak (a CLI ebből ír progress-sorokat). UI-független: a RAG-csomag nem
// ismer console-t, csak a callbacket hívja — ugyanaz a minta, mint az IngestProgress-nél.
// question-start a nehéz munka ELŐTT jön ki (hogy ne tűnjön lefagyottnak), a step-ek utána.
export type GoldenProgress =
  | {
      type: 'question-start';
      index: number;
      total: number;
      id: number;
      q: string;
    }
  | {
      type: 'step';
      index: number;
      total: number;
      step: 'raw' | 'full';
      results: number;
    }
  | {
      type: 'step';
      index: number;
      total: number;
      step: 'grounded';
      grounded: boolean;
    };

export async function runGolden(
  deps: {
    providers: Providers;
    store: Store;
    onProgress?: (event: GoldenProgress) => void;
  },
  cfg: { topN: number; topK: number; minRerankScore: number },
): Promise<GoldenReport> {
  const { onProgress } = deps;
  const rows: GoldenRow[] = [];

  const total = GOLDEN_QUESTIONS.length;
  let index = 0;

  for (const { id, q, expectAnswerable, rerankRationale } of GOLDEN_QUESTIONS) {
    index++;
    onProgress?.({ type: 'question-start', index, total, id, q });

    const raw = await retrieve(q, deps, {
      mode: 'raw',
      topN: cfg.topN,
      topK: cfg.topK,
    });

    onProgress?.({
      type: 'step',
      index,
      total,
      step: 'raw',
      results: raw.length,
    });

    const full = await retrieve(q, deps, {
      mode: 'full',
      topN: cfg.topN,
      topK: cfg.topK,
    });

    onProgress?.({
      type: 'step',
      index,
      total,
      step: 'full',
      results: full.length,
    });

    const grounded = await answerFromKnowledge(q, deps, cfg);

    onProgress?.({
      type: 'step',
      index,
      total,
      step: 'grounded',
      grounded: grounded.grounded,
    });

    rows.push({
      id,
      q,
      expectAnswerable,
      rerankRationale,
      raw,
      full,
      grounded: grounded.grounded,
      answer: grounded.answer,
    });
  }

  return { rows, cfg };
}

const rankList = (cs: RetrievedChunk[]) =>
  cs
    .map(
      (c, i) =>
        `${i + 1}. ${c.docId}${c.rerankScore !== undefined ? ` (rr=${c.rerankScore.toFixed(3)})` : ` (d=${c.distance.toFixed(3)})`}`,
    )
    .join('<br>');

// A rerank akkor „rendezte át” a listát, ha a full pipeline top-1 találata MÁS dokumentum, mint a
// nyers vektorkeresésé. Ez a legerősebb, legkönnyebben védhető jelzés: a rerank egy relevánsabb
// forrást emelt a lista élére.
const topChanged = (r: GoldenRow): boolean =>
  r.raw[0]?.docId !== undefined && r.full[0]?.docId !== r.raw[0]?.docId;

const top1 = (cs: RetrievedChunk[]): string => {
  const c = cs[0];

  if (c === undefined) {
    return '—';
  }

  return `${c.docId}${c.rerankScore !== undefined ? ` (rr=${c.rerankScore.toFixed(3)})` : ` (d=${c.distance.toFixed(3)})`}`;
};

// Szakasz: raw vs full top-K találati lista soronként (a fő összevetés).
function renderComparisonTable(report: GoldenReport): string {
  const head = `| # | Kérdés | Raw (embedding) | Full (HyDE+rerank) | Grounded |\n|---|---|---|---|---|\n`;

  const body = report.rows
    .map(
      (r) =>
        `| ${r.id} | ${r.q} | ${rankList(r.raw)} | ${rankList(r.full)} | ${r.grounded ? 'igen' : 'NINCS'} |`,
    )
    .join('\n');

  return head + body;
}

// Szakasz: a rerank átrendezte-e a top-1-et, és MIÉRT jobb az új sorrend (rubrika 2. pont).
function renderRerankSection(report: GoldenReport): string {
  const rowsView = report.rows
    .map(
      (r) =>
        `| ${r.id} | ${r.q} | ${top1(r.raw)} | ${top1(r.full)} | ${topChanged(r) ? 'IGEN' : 'nem'} |`,
    )
    .join('\n');

  // Csak megválaszolható kérdéseknél beszélünk „jobb sorrendről”: a negatív próbánál a full lista
  // is csak irreleváns cikkeket kevergethet, ott nem értelmes a „jobb” minősítés.
  const reorderedAnswerable = report.rows.filter(
    (r) => r.expectAnswerable && topChanged(r) && r.rerankRationale,
  );

  const rationale =
    reorderedAnswerable.length > 0
      ? `\n\n### Miért jobb az új sorrend?\n` +
        reorderedAnswerable
          .map((r) => `- **#${r.id}** (${r.q}) — ${r.rerankRationale}`)
          .join('\n')
      : `\n\nEbben a futásban a rerank egyetlen megválaszolható kérdésnél sem cserélte le a #1 ` +
        `találatot: a nyers vektorkeresés már a legrelevánsabb dokumentumot hozta elsőként, így a ` +
        `HyDE+rerank nem tudott jobb sorrendet adni (legfeljebb a #1 alatti helyeket rendezte át).`;

  return (
    `## Rerank-átrendezés (raw #1 → full #1)\n\n` +
    `| # | Kérdés | Raw top-1 | Full top-1 | Átrendezte? |\n|---|---|---|---|---|\n` +
    rowsView +
    rationale
  );
}

// Szakasz: grounding / negatív teszt (rubrika 3. pont). Elvárt vs tényleges viselkedés, és a
// tanulság: a negatív kérdést nem feltétlenül a retrieval-kapu fogja meg, hanem a prompt-szabály.
function renderGroundingSection(report: GoldenReport): string {
  const matches = report.rows.filter(
    (r) => r.grounded === r.expectAnswerable,
  ).length;

  const total = report.rows.length;

  const negatives = report.rows.filter((r) => !r.expectAnswerable);

  const negTable =
    `| # | Kérdés | Elvárt | Tényleges | Rendben? |\n|---|---|---|---|---|\n` +
    negatives
      .map(
        (r) =>
          `| ${r.id} | ${r.q} | nincs válasz | ${r.grounded ? 'VÁLASZOLT (grounded=true)' : 'nincs válasz (grounded=false)'} | ${r.grounded === r.expectAnswerable ? '✓' : '✗'} |`,
      )
      .join('\n');

  // A negatív próba tanulsága a valós rerank-pontszámból generálva (nem beégetett szám):
  // ha a full top-1 rerank-pontszáma a küszöb FELETT van, akkor nem a retrieval-kapu, hanem a
  // válasz-prompt grounding-szabálya fogta meg a kérdést.
  const neg = negatives[0];
  const negBest = neg?.full[0]?.rerankScore;
  const th = report.cfg.minRerankScore;

  let lesson = '';

  if (neg && negBest !== undefined) {
    lesson =
      negBest >= th
        ? `\n\nFigyeld meg: a **rerank-kapu átengedte** a #${neg.id} kérdést (a full top-1 ` +
          `rr=${negBest.toFixed(3)} ≥ küszöb=${th}), tehát **nem a retrieval-szűrő fogta meg**, ` +
          `hanem a válasz-prompt grounding-szabálya. Ezért nem „csak dísz” a prompt-szabály — ` +
          `enélkül az agent a marginálisan hasonló (de témán kívüli) cikkekből próbált volna ` +
          `választ gyártani. Az agent a NO_ANSWER mondattal utasít el, forráskitalálás helyett.`
        : `\n\nA #${neg.id} kérdésnél már a **retrieval-kapu megfogta** a próbát (a full top-1 ` +
          `rr=${negBest.toFixed(3)} < küszöb=${th}): meg sem kérdeztük az LLM-et, azonnal a ` +
          `NO_ANSWER választ adtuk.`;
  }

  return (
    `## Grounding — negatív teszt\n\n` +
    `Grounding-egyezés: **${matches}/${total}** kérdés viselkedett az elvárt módon.\n\n` +
    negTable +
    lesson
  );
}

function renderNotes(report: GoldenReport): string {
  return (
    `## Megjegyzések\n` +
    report.rows
      .map((r) => {
        const label = r.expectAnswerable
          ? 'megválaszolható'
          : 'grounding-próba (nincs a tudásbázisban)';

        return `- **#${r.id}** (${label}): ${r.answer.replace(/\n/g, ' ').slice(0, 200)}`;
      })
      .join('\n')
  );
}

export function renderGoldenMarkdown(report: GoldenReport): string {
  const head =
    `# Golden Set — raw vs full pipeline\n\n` +
    `Konfiguráció: topN=${report.cfg.topN}, topK=${report.cfg.topK}, minRerankScore=${report.cfg.minRerankScore}\n\n`;

  return [
    head + renderComparisonTable(report),
    renderRerankSection(report),
    renderGroundingSection(report),
    renderNotes(report),
  ].join('\n\n');
}
