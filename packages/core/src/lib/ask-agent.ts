import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { SYSTEM_PROMPT } from './system-prompt.js';
import { logInteraction } from './logger.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;

// A bemenet megbízhatatlan (user input): validáljuk a rendszer-határon, fail-fast.
const QuestionSchema = z.string().trim().min(1, 'A kérdés nem lehet üres.');

export interface Prompt {
  system: string;
  messages: Anthropic.MessageParam[];
}

// A modell válaszának content tömbjéből kinyeri az összefűzött szöveget (a nem-text blokkokat kihagyja).
export function extractText(content: ReadonlyArray<{ type: string; text?: string }>): string {
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

// A kérdésből felépíti a system promptot + üzenet-tömböt (még tool nélkül — B2).
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

function getConfig(): { apiKey: string; model: string } {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Hiányzik az ANTHROPIC_API_KEY. Állítsd be a .env fájlban.');
  }
  return { apiKey, model: process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL };
}

export interface AgentResult {
  answer: string;
  usage: Anthropic.Usage;
}

// B2: egyszeri LLM-hívás, tool NÉLKÜL. A választ természetes nyelven adja vissza, és
// minden interakciót JSONL-be naplóz. (A B3 fázis köti be a runSql toolt és a multistep loopot.)
export async function askAgent(input: unknown): Promise<AgentResult> {
  const { apiKey, model } = getConfig();
  const prompt = buildPrompt(input);
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system: prompt.system,
    messages: prompt.messages,
  });

  const answer = extractText(response.content);

  logInteraction({
    timestamp: new Date().toISOString(),
    model,
    system: prompt.system,
    messages: prompt.messages,
    answer,
    usage: response.usage,
  });

  return { answer, usage: response.usage };
}
