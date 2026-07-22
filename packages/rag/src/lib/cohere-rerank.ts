import type { RagConfig } from './config.js';
import type { RerankHit } from './providers.js';

export async function rerankFromCohere(
  cfg: RagConfig,
  query: string,
  docs: string[],
  topN: number,
): Promise<RerankHit[]> {
  if (docs.length === 0) return [];
  const res = await fetch('https://api.cohere.com/v2/rerank', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${cfg.cohereApiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: cfg.rerankModel,
      query,
      documents: docs,
      top_n: Math.min(topN, docs.length),
    }),
  });
  if (!res.ok)
    throw new Error(`Cohere rerank hiba: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as {
    results: { index: number; relevance_score: number }[];
  };
  return json.results.map((r) => ({
    index: r.index,
    score: r.relevance_score,
  }));
}
