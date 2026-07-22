import { createOpenAI } from '@ai-sdk/openai';
import { embedMany } from 'ai';
import type { RagConfig } from './config.js';

export async function embedFromOpenAI(
  cfg: RagConfig,
  texts: string[],
): Promise<number[][]> {
  const openai = createOpenAI({ apiKey: cfg.openaiApiKey });
  const { embeddings } = await embedMany({
    model: openai.embedding(cfg.embedModel),
    values: texts,
  });
  return embeddings;
}
