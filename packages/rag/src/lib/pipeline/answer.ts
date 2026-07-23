import { retrieve, type RetrievedChunk } from './retrieve.js';
import type { Providers } from '../providers/providers.js';
import type { Store } from '../storage/store.js';

export const NO_ANSWER = 'Erről nincs információ a Plantbase tudásbázisban.';

const ANSWER_SYSTEM =
  'Te a Plantbase növénygondozási asszisztense vagy. KIZÁRÓLAG a megadott kontextusból válaszolj, ' +
  'magyarul, tömören. Ha a kontextus nem fedi a kérdést, mondd ki, hogy nincs róla információ. ' +
  'A válasz végén sorold fel a felhasznált forrásokat (cím — URL). Soha ne találj ki forrást.';

export interface GroundedAnswer {
  answer: string;
  grounded: boolean;
  sources: { title: string; source: string }[];
}

export function buildGroundingPrompt(
  query: string,
  chunks: RetrievedChunk[],
): string {
  const ctx = chunks
    .map((c, i) => `[${i + 1}] Forrás: ${c.title} — ${c.source}\n${c.content}`)
    .join('\n\n---\n\n');
  return `Kérdés: ${query}\n\nKontextus:\n${ctx}`;
}

export async function answerFromKnowledge(
  query: string,
  deps: { providers: Providers; store: Store },
  opts: { topN: number; topK: number; minRerankScore: number },
): Promise<GroundedAnswer> {
  const chunks = await retrieve(query, deps, {
    mode: 'full',
    topN: opts.topN,
    topK: opts.topK,
  });
  const best = chunks[0]?.rerankScore ?? 0;
  if (chunks.length === 0 || best < opts.minRerankScore)
    return { answer: NO_ANSWER, grounded: false, sources: [] };
  const answer = await deps.providers.answer(
    ANSWER_SYSTEM,
    buildGroundingPrompt(query, chunks),
  );
  const seen = new Set<string>();
  const sources = chunks
    .filter((c) => !seen.has(c.source) && seen.add(c.source))
    .map((c) => ({ title: c.title, source: c.source }));
  return { answer, grounded: true, sources };
}
