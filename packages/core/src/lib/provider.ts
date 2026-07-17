import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';

// A modell-választás egyetlen csere-pontja. Új provider = egy új ág ide, sehol máshol.
const DEFAULT_MODEL = 'claude-sonnet-4-6';

// Env-ből épít egy AI SDK modellt. Fail-fast, beszédes magyar hibával (mint a régi getConfig).
export function resolveModel(): LanguageModel {
  const provider = process.env.AI_PROVIDER ?? 'anthropic';
  if (provider !== 'anthropic') {
    throw new Error(
      `Ismeretlen AI_PROVIDER: ${provider}. Jelenleg csak az 'anthropic' támogatott.`,
    );
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Hiányzik az ANTHROPIC_API_KEY. Állítsd be a .env fájlban.');
  }
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  return createAnthropic({ apiKey })(model);
}
