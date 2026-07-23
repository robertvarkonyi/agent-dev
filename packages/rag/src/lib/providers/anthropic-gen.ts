import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import type { RagConfig } from '../config.js';
import { UsageFn, type UsageTracker } from './usage.js';

const HYDE_SYSTEM =
  'You write a short, factual hypothetical passage (3-5 sentences) that would answer the question, ' +
  'as if excerpted from a houseplant care article. Write in English. No preamble.';

// Az AI SDK usage-ből a teljes token-számot adja (totalTokens, vagy input+output ha az hiányzik).
function totalTokens(usage: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}): number {
  return (
    usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
  );
}

export async function hydeFromAnthropic(
  cfg: RagConfig,
  query: string,
  tracker?: UsageTracker,
): Promise<string> {
  const anthropic = createAnthropic({ apiKey: cfg.anthropicApiKey });
  const { text, usage } = await generateText({
    model: anthropic(cfg.hydeModel),
    system: HYDE_SYSTEM,
    prompt: query,
  });

  tracker?.add('anthropic', cfg.hydeModel, UsageFn.hyde, totalTokens(usage));

  return text;
}

export async function answerFromAnthropic(
  cfg: RagConfig,
  system: string,
  prompt: string,
  tracker?: UsageTracker,
): Promise<string> {
  const anthropic = createAnthropic({ apiKey: cfg.anthropicApiKey });
  const { text, usage } = await generateText({
    model: anthropic(cfg.answerModel),
    system,
    prompt,
  });

  tracker?.add(
    'anthropic',
    cfg.answerModel,
    UsageFn.answer,
    totalTokens(usage),
  );

  return text;
}
