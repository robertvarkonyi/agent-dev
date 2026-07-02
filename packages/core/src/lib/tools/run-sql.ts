import { Pool } from 'pg';
import { z } from 'zod';

const SqlSchema = z.string().trim().min(1, 'Üres SQL.');

// Adatmódosító / DDL kulcsszavak — kód-szintű védelem (a valódi garancia a read-only DB-role).
const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|merge)\b/i;

// SELECT-guard: csak egyetlen SELECT (vagy WITH ... SELECT) engedélyezett. Fail-fast, beszédes hiba.
// Visszaadja a normalizált (lezáró pontosvessző nélküli) SQL-t.
export function assertSelectOnly(input: unknown): string {
  const parsed = SqlSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Érvénytelen SQL.');
  }

  const sql = parsed.data.replace(/;+\s*$/, '').trim();
  if (sql.length === 0) {
    throw new Error('Üres SQL.');
  }
  if (sql.includes(';')) {
    throw new Error(
      'Csak egyetlen utasítás engedélyezett (nincs pontosvessző a lekérdezésben).',
    );
  }
  if (!/^(select|with)\b/i.test(sql)) {
    throw new Error(
      'Csak SELECT (vagy WITH ... SELECT) lekérdezés engedélyezett.',
    );
  }
  if (FORBIDDEN.test(sql)) {
    throw new Error(
      'Adatmódosító vagy DDL kulcsszó nem engedélyezett (csak SELECT).',
    );
  }
  return sql;
}

let pool: Pool | undefined;

// Lazy singleton Pool a READ-ONLY kapcsolaton (az agent NEM Prismán kérdez — architektura.md 2).
function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL_READONLY;
    if (!connectionString) {
      throw new Error(
        'Hiányzik a DATABASE_URL_READONLY. Állítsd be a .env-ben.',
      );
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

export interface SqlResult {
  sql: string;
  rows: unknown[];
  rowCount: number;
}

// Read-only SELECT futtatása a katalóguson (SELECT-guard + read-only role kettős védelme).
export async function runSql(input: unknown): Promise<SqlResult> {
  const sql = assertSelectOnly(input);
  const result = await getPool().query(sql);
  return {
    sql,
    rows: result.rows,
    rowCount: result.rowCount ?? result.rows.length,
  };
}
