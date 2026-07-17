import {
  generateText,
  stepCountIs,
  type LanguageModel,
  type ModelMessage,
} from 'ai';
import { z } from 'zod';
import { SYSTEM_PROMPT } from './system-prompt.js';
import { logInteraction } from './logger.js';
import { resolveModel } from './provider.js';
import { buildTools, type ToolCall } from './agent-tools.js';

// A többlépéses tool-use loop felső korlátja (most az SDK-é: stopWhen).
const MAX_STEPS = 6;

// A bemenet megbízhatatlan (user input): validáljuk a rendszer-határon, fail-fast.
const QuestionSchema = z.string().trim().min(1, 'A kérdés nem lehet üres.');

export interface Prompt {
  system: string;
  messages: ModelMessage[];
}

export interface AgentResult {
  answer: string;
  usage: { input_tokens: number; output_tokens: number };
}

// A CLI ezt tartja a chat-előzményben (nem importál 'ai'-t közvetlenül).
export type ChatMessage = ModelMessage;

// A kérdésből felépíti a system promptot + üzenet-tömböt (--show-prompt + askAgent).
export function buildPrompt(input: unknown): Prompt {
  const result = QuestionSchema.safeParse(input);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? 'Érvénytelen bemenet.');
  }
  return {
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: result.data }],
  };
}

// Az AI SDK usage-mezőit a meglévő napló-alakra képezi (0 default, ha a provider nem ad értéket).
function mapUsage(
  u: { inputTokens?: number; outputTokens?: number } | undefined,
): AgentResult['usage'] {
  return { input_tokens: u?.inputTokens ?? 0, output_tokens: u?.outputTokens ?? 0 };
}

// A modell azonosítója a naplóhoz (string modell-id vagy a LanguageModel.modelId).
function modelId(model: LanguageModel): string {
  return typeof model === 'string'
    ? model
    : (model as { modelId?: string }).modelId ?? 'unknown';
}

// Egyfordulós agent: a modell a buildTools tooljaival dolgozik, az SDK futtatja a
// többlépéses loopot (stopWhen), majd természetes nyelvű választ ad. A `model` teszthez
// injektálható; alapból az env-vezérelt resolveModel().
export async function askAgent(
  input: unknown,
  model: LanguageModel = resolveModel(),
): Promise<AgentResult> {
  const prompt = buildPrompt(input);
  const collector: ToolCall[] = [];

  const result = await generateText({
    model,
    system: prompt.system,
    messages: prompt.messages,
    tools: buildTools(collector),
    stopWhen: stepCountIs(MAX_STEPS),
  });

  const usage = mapUsage(result.usage);
  logInteraction({
    timestamp: new Date().toISOString(),
    model: modelId(model),
    system: prompt.system,
    messages: result.response.messages,
    answer: result.text,
    usage,
    sql: collector.map((c) => c.sql).join('\n'),
    result: collector.map((c) => c.rows),
  });

  return { answer: result.text, usage };
}
