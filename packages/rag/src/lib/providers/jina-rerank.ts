import type { RagConfig } from '../config.js';
import type { RerankHit } from './providers.js';
import type { UsageTracker } from './usage.js';

// Jina rerank (cross-encoder). A válasz `results[].index`/`relevance_score` alakja adja a
// Providers.rerank szerződését. Többnyelvű modell (magyar query is).
export async function rerankFromJina(
  cfg: RagConfig,
  query: string,
  docs: string[],
  topN: number,
  tracker?: UsageTracker,
): Promise<RerankHit[]> {
  if (docs.length === 0) {
    return [];
  }

  const res = await fetch('https://api.jina.ai/v1/rerank', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${cfg.jinaApiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: cfg.rerankModel,
      query,
      documents: docs,
      top_n: Math.min(topN, docs.length),
      return_documents: false,
    }),
  });

  if (!res.ok) {
    throw new Error(`Jina rerank hiba: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as {
    results: { index: number; relevance_score: number }[];
    usage?: { total_tokens?: number };
  };

  tracker?.add('jina', cfg.rerankModel, json.usage?.total_tokens ?? 0);

  return json.results.map((r) => ({
    index: r.index,
    score: r.relevance_score,
  }));
}
