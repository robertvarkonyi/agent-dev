import { retrieve, type RetrievedChunk } from './retrieve.js';
import type { Providers } from '../providers/providers.js';
import type { Store } from '../storage/store.js';

export const NO_ANSWER = 'Erről nincs információ a Plantbase tudásbázisban.';

const ANSWER_SYSTEM =
  'Te a Plantbase növénygondozási asszisztense vagy. KIZÁRÓLAG a megadott kontextusból válaszolj, ' +
  'magyarul, tömören. ' +
  `Ha a kontextus nem fedi a kérdést, NE találgass és NE sorolj fel forrást: a válaszod ELSŐ mondata SZÓ SZERINT, idézőjelek nélkül ez legyen: ${NO_ANSWER} ` +
  'Ezután egy rövid mondatban jelezheted, mit fednek le valójában a források. ' +
  'Ha a kontextus fedi a kérdést, a válasz végén sorold fel a felhasznált forrásokat (cím — URL). Soha ne találj ki forrást.';

// A prompt-szabály grounding-jelzésének felismerése: a refuzált válasz a NO_ANSWER mondattal kezdődik
// (a modell utána indokolhat röviden). A modell néha idézőjelbe/formázásba csomagolja a mondatot
// (pl. "Erről nincs információ…"), ezért a vezető NEM-betű karaktereket (idézőjel, szóköz, csillag,
// kötőjel) levágjuk az egyezés előtt — a NO_ANSWER betűvel kezdődik, így ez biztonságos. Nincs fuzzy
// találgatás: a levágás után szó szerinti startsWith kell.
function isRefusal(answer: string): boolean {
  return answer.replace(/^[^\p{L}]+/u, '').startsWith(NO_ANSWER);
}

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

  // 1. rétegű grounding — retrieval-kapu: ha a legjobb rerank-pontszám a küszöb alatt van, meg se
  // kérdezzük az LLM-et (nincs elég releváns kontextus).
  if (chunks.length === 0 || best < opts.minRerankScore) {
    return { answer: NO_ANSWER, grounded: false, sources: [] };
  }

  const answer = await deps.providers.answer(
    ANSWER_SYSTEM,
    buildGroundingPrompt(query, chunks),
  );

  // 2. rétegű grounding — prompt-szabály: a kapu átengedheti a marginálisan hasonló, de valójában
  // nem releváns kontextust (pl. Vénusz-légycsapó a golden setben, rr>küszöb) — ilyenkor az LLM a
  // NO_ANSWER mondattal utasít el, és NEM sorolunk fel hozzá forrást.
  if (isRefusal(answer)) {
    return { answer, grounded: false, sources: [] };
  }

  const seen = new Set<string>();
  const sources = chunks
    .filter((c) => !seen.has(c.source) && seen.add(c.source))
    .map((c) => ({ title: c.title, source: c.source }));

  return { answer, grounded: true, sources };
}
