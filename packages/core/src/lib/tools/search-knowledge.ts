import { tool } from 'ai';
import { z } from 'zod';
import type { GroundedAnswer } from '@plantbase/rag';

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
    execute: async ({ query }) => answer(query),
  });
}
