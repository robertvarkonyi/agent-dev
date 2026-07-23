import { createOpenAI } from '@ai-sdk/openai';
import { embedMany } from 'ai';
import type { RagConfig } from '../config.js';
import { UsageFn, type UsageTracker } from './usage.js';

export async function embedFromOpenAI(
  cfg: RagConfig,
  texts: string[],
  tracker?: UsageTracker,
): Promise<number[][]> {
  const openai = createOpenAI({ apiKey: cfg.openaiApiKey });
  const { embeddings, usage } = await embedMany({
    model: openai.embedding(cfg.embedModel),
    values: texts,
  });

  tracker?.add('openai', cfg.embedModel, UsageFn.embedding, usage?.tokens ?? 0);

  return embeddings;
}
