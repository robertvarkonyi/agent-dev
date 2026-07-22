import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import type { RagConfig } from './config.js';

const HYDE_SYSTEM =
  'You write a short, factual hypothetical passage (3-5 sentences) that would answer the question, ' +
  'as if excerpted from a houseplant care article. Write in English. No preamble.';

export async function hydeFromAnthropic(
  cfg: RagConfig,
  query: string,
): Promise<string> {
  const anthropic = createAnthropic({ apiKey: cfg.anthropicApiKey });
  const { text } = await generateText({
    model: anthropic(cfg.hydeModel),
    system: HYDE_SYSTEM,
    prompt: query,
  });
  return text;
}

export async function answerFromAnthropic(
  cfg: RagConfig,
  system: string,
  prompt: string,
): Promise<string> {
  const anthropic = createAnthropic({ apiKey: cfg.anthropicApiKey });
  const { text } = await generateText({
    model: anthropic(cfg.answerModel),
    system,
    prompt,
  });
  return text;
}
