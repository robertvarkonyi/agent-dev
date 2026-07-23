export interface RagConfig {
  openaiApiKey: string;
  jinaApiKey: string;
  anthropicApiKey: string;
  embedModel: string;
  rerankModel: string;
  hydeModel: string;
  answerModel: string;
  minRerankScore: number;
  topN: number;
  topK: number;
}

function req(env: Record<string, string | undefined>, key: string): string {
  const v = env[key];

  if (!v) {
    throw new Error(`Hiányzik a ${key}. Állítsd be a .env fájlban.`);
  }

  return v;
}

function num(
  env: Record<string, string | undefined>,
  key: string,
  dflt: number,
): number {
  const v = env[key];

  if (v === undefined || v === '') {
    return dflt;
  }

  const n = Number(v);

  if (Number.isNaN(n)) {
    throw new Error(`A ${key} nem szám: ${v}`);
  }

  return n;
}

export function loadRagConfig(
  env: Record<string, string | undefined> = process.env,
): RagConfig {
  return {
    openaiApiKey: req(env, 'OPENAI_API_KEY'),
    jinaApiKey: req(env, 'JINA_API_KEY'),
    anthropicApiKey: req(env, 'ANTHROPIC_API_KEY'),
    embedModel: env.OPENAI_EMBED_MODEL || 'text-embedding-3-small',
    rerankModel: env.JINA_RERANK_MODEL || 'jina-reranker-v2-base-multilingual',
    hydeModel: env.ANTHROPIC_HYDE_MODEL || 'claude-haiku-4-5',
    answerModel: env.ANTHROPIC_ANSWER_MODEL || 'claude-sonnet-4-6',
    minRerankScore: num(env, 'RAG_MIN_RERANK_SCORE', 0.3),
    topN: num(env, 'RAG_TOP_N', 20),
    topK: num(env, 'RAG_TOP_K', 5),
  };
}
