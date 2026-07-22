import { retrieve, type RetrievedChunk } from './retrieve.js';
import { answerFromKnowledge } from './answer.js';
import type { Providers } from './providers.js';
import type { Store } from './store.js';

export const GOLDEN_QUESTIONS = [
  {
    id: 1,
    q: 'Milyen fényt igényel a Monstera deliciosa?',
    note: 'answerable',
  },
  {
    id: 2,
    q: 'Milyen gyakran öntözzem a kígyónövényt (snake plant)?',
    note: 'answerable',
  },
  { id: 3, q: 'Hogyan szaporítsak pothost dugványról?', note: 'answerable' },
  { id: 4, q: 'Miért sárgulnak a növényem levelei?', note: 'answerable' },
  {
    id: 5,
    q: 'Hogyan szabaduljak meg a gombaszúnyogoktól?',
    note: 'answerable',
  },
  {
    id: 6,
    q: 'Miért lyukasak a Monstera / swiss cheese növény levelei?',
    note: 'rerank-átrendezés jelölt',
  },
  {
    id: 7,
    q: 'Melyik szobanövény biztonságos macskák mellé?',
    note: 'answerable',
  },
  {
    id: 8,
    q: 'Hogyan gondozzam a húsevő Vénusz légycsapót?',
    note: 'MEGVÁLASZOLHATATLAN — grounding próba',
  },
] as const;

export interface GoldenRow {
  id: number;
  q: string;
  note: string;
  raw: RetrievedChunk[];
  full: RetrievedChunk[];
  grounded: boolean;
  answer: string;
}
export interface GoldenReport {
  rows: GoldenRow[];
  cfg: { topN: number; topK: number; minRerankScore: number };
}

export async function runGolden(
  deps: { providers: Providers; store: Store },
  cfg: { topN: number; topK: number; minRerankScore: number },
): Promise<GoldenReport> {
  const rows: GoldenRow[] = [];
  for (const { id, q, note } of GOLDEN_QUESTIONS) {
    const raw = await retrieve(q, deps, {
      mode: 'raw',
      topN: cfg.topN,
      topK: cfg.topK,
    });
    const full = await retrieve(q, deps, {
      mode: 'full',
      topN: cfg.topN,
      topK: cfg.topK,
    });
    const grounded = await answerFromKnowledge(q, deps, cfg);
    rows.push({
      id,
      q,
      note,
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

export function renderGoldenMarkdown(report: GoldenReport): string {
  const head =
    `# Golden Set — raw vs full pipeline\n\n` +
    `Konfiguráció: topN=${report.cfg.topN}, topK=${report.cfg.topK}, minRerankScore=${report.cfg.minRerankScore}\n\n` +
    `| # | Kérdés | Raw (embedding) | Full (HyDE+rerank) | Grounded |\n|---|---|---|---|---|\n`;
  const body = report.rows
    .map(
      (r) =>
        `| ${r.id} | ${r.q} | ${rankList(r.raw)} | ${rankList(r.full)} | ${r.grounded ? 'igen' : 'NINCS'} |`,
    )
    .join('\n');
  const notes =
    `\n\n## Megjegyzések\n` +
    report.rows
      .map(
        (r) =>
          `- **#${r.id}** (${r.note}): ${r.answer.replace(/\n/g, ' ').slice(0, 200)}`,
      )
      .join('\n');
  return head + body + notes;
}
