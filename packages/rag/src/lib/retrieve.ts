import type { Providers } from './providers.js';
import type { Store } from './store.js';

export interface RetrievedChunk {
  docId: string;
  title: string;
  source: string;
  category: string;
  headingPath: string;
  content: string;
  distance: number;
  rerankScore?: number;
}

export async function retrieve(
  query: string,
  deps: { providers: Providers; store: Store },
  opts: { mode: 'raw' | 'full'; topN: number; topK: number },
): Promise<RetrievedChunk[]> {
  const { providers, store } = deps;
  const embedText = opts.mode === 'full' ? await providers.hyde(query) : query;
  const [embedding] = await providers.embed([embedText]);
  const hits = await store.similaritySearch(
    embedding,
    opts.mode === 'full' ? opts.topN : opts.topK,
  );
  if (opts.mode === 'raw') return hits.slice(0, opts.topK);

  const ranked = await providers.rerank(
    query,
    hits.map((h) => h.content),
    opts.topK,
  );
  return ranked.map((r) => ({ ...hits[r.index], rerankScore: r.score }));
}
