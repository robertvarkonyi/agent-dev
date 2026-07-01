import { z } from 'zod';

// A bemenet megbízhatatlan (user input): validáljuk a rendszer-határon, fail-fast.
const QuestionSchema = z.string().trim().min(1, 'A kérdés nem lehet üres.');

// B1: az agent egyelőre visszhangozza a (trimmelt) bemenetet — echo.
// A B2 fázisban ezt LLM-hívás (askAgent) váltja fel.
export function echo(input: unknown): string {
  const result = QuestionSchema.safeParse(input);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? 'Érvénytelen bemenet.');
  }
  return result.data;
}
