import { runSql } from './run-sql.js';

// A distinct kategóriák lekérdezése (rendezett). A runSql SELECT-guardja + a read-only role védi.
export const CATEGORIES_SQL =
  'SELECT DISTINCT category FROM products ORDER BY category';

// A DB-ből jövő sorok megbízhatatlanok (unknown[]): a category string mezőt szűrjük ki,
// a nem-string / üres értéket eldobjuk, és defenzíven dedupálunk. Sosem dob (fail-soft).
export function extractCategories(rows: unknown[]): string[] {
  const seen = new Set<string>();
  const categories: string[] = [];
  for (const row of rows) {
    const value = (row as { category?: unknown }).category;
    if (typeof value === 'string' && value.length > 0 && !seen.has(value)) {
      seen.add(value);
      categories.push(value);
    }
  }
  return categories;
}

// A katalógus egyedi kategóriái. A meglévő runSql-t hasznosítja újra (read-only pool + guard).
export async function listCategories(): Promise<string[]> {
  const result = await runSql(CATEGORIES_SQL);
  return extractCategories(result.rows);
}
