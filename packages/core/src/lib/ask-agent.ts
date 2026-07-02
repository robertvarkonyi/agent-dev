import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { SYSTEM_PROMPT } from './system-prompt.js';
import { logInteraction } from './logger.js';
import { errorMessage } from './errors.js';
import { TOOLS, toolDefinitions } from './tools/registry.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;
// A többlépéses tool-use loop felső korlátja (védelem a végtelen ciklus ellen).
const MAX_STEPS = 6;

// A bemenet megbízhatatlan (user input): validáljuk a rendszer-határon, fail-fast.
const QuestionSchema = z.string().trim().min(1, 'A kérdés nem lehet üres.');

export interface Prompt {
  system: string;
  messages: Anthropic.MessageParam[];
}

// A modell válaszának content tömbjéből kinyeri az összefűzött szöveget (a nem-text blokkokat kihagyja).
// A strukturális paramétertípus szándékos: közvetlenül elfogadja az Anthropic.ContentBlock[]-et
// (pl. response.content) cast nélkül, ugyanakkor a tesztekben minimál blokkokkal is hívható.
export function extractText(
  content: ReadonlyArray<{ type: string; text?: string }>,
): string {
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
    throw new Error(
      'Hiányzik az ANTHROPIC_API_KEY. Állítsd be a .env fájlban.',
    );
  }
  return { apiKey, model: process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL };
}

export interface AgentResult {
  answer: string;
  usage: { input_tokens: number; output_tokens: number };
}

// B3: kézzel írt, többlépéses tool-use loop. A modell SQL-t ír, a runSql toollal read-only
// lefuttatjuk a katalóguson, az eredményt tool_result-ként visszafűzzük, és ismételjük, amíg a
// modell természetes nyelvű választ ad (stop_reason !== 'tool_use'). NEM használjuk a toolRunner
// helpert — a mechanika látható marad (architektura.md 3).
export async function askAgent(input: unknown): Promise<AgentResult> {
  const { apiKey, model } = getConfig();
  const prompt = buildPrompt(input);
  const client = new Anthropic({ apiKey });

  const messages: Anthropic.MessageParam[] = [...prompt.messages];
  const executedSql: string[] = [];
  const sqlResults: unknown[] = [];
  const usage = { input_tokens: 0, output_tokens: 0 };
  let response: Anthropic.Message | undefined;

  for (let step = 0; step < MAX_STEPS; step++) {
    response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: prompt.system,
      messages,
      tools: toolDefinitions,
    });
    usage.input_tokens += response.usage.input_tokens;
    usage.output_tokens += response.usage.output_tokens;

    if (response.stop_reason !== 'tool_use') {
      break;
    }

    // Az assistant tool-hívását visszafűzzük, majd minden tool_use blokkra a regiszterből
    // futtatjuk a megfelelő toolt, és tool_result-ként visszafűzzük az eredményt.
    messages.push({ role: 'assistant', content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') {
        continue;
      }
      const tool = TOOLS[block.name];
      if (!tool) {
        continue;
      }
      try {
        const { sql, rows } = await tool.run(block.input);
        executedSql.push(sql);
        sqlResults.push(rows);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(rows),
        });
      } catch (error) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: `Hiba: ${errorMessage(error)}`,
          is_error: true,
        });
      }
    }
    messages.push({ role: 'user', content: toolResults });
  }

  const answer = response ? extractText(response.content) : '';

  logInteraction({
    timestamp: new Date().toISOString(),
    model,
    system: prompt.system,
    messages,
    answer,
    usage,
    sql: executedSql.join('\n'),
    result: sqlResults,
  });

  return { answer, usage };
}
