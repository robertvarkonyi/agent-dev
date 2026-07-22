import { tool } from 'ai';
import { z } from 'zod';
import type { GroundedAnswer } from '@plantbase/rag';
import { errorMessage } from '../errors.js';

export type AnswerFn = (query: string) => Promise<GroundedAnswer>;

// A tool a DI-vel kapott answer-függvényt hívja (teszt: fake; éles: a config.ts-ből felépített pipeline).
export function buildSearchKnowledge(answer: AnswerFn) {
  return tool({
    description:
      'Növénygondozási TUDÁS-kérdésekre (hogyan gondozzam / miért / tünetek) keres a Plantbase ' +
      'tudásbázisban (cikkek). Nem katalógus-kérdésekre. Forráshivatkozásos, grounded választ ad; ' +
      'ha nincs találat, azt jelzi (grounded=false) — ilyenkor mondd ki, hogy nincs róla információ.',
    inputSchema: z.object({
      query: z.string().describe('A tudás-kérdés természetes nyelven.'),
    }),
    // Az execute SOSEM dobhat: a dobott Error az AI SDK-ban üres tool_result-tá szerializálódik
    // (JSON.stringify(Error) === '{}'), amit az Anthropic 400-zal elutasít (is_error + üres content).
    // Helyette beszédes, NEM üres hibaszöveget adunk vissza — a modell olvassa és aszerint válaszol.
    execute: async ({ query }) => {
      try {
        return await answer(query);
      } catch (error) {
        return `Hiba: ${errorMessage(error)}`;
      }
    },
  });
}
