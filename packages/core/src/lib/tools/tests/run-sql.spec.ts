import { describe, it, expect } from 'vitest';
import { assertSelectOnly } from '../run-sql.js';

describe('assertSelectOnly', () => {
  it('elfogadja az egyszerű SELECT-et', () => {
    expect(assertSelectOnly('SELECT * FROM products')).toBe(
      'SELECT * FROM products',
    );
  });

  it('kis/nagybetűtől függetlenül elfogad', () => {
    expect(assertSelectOnly('select id from products')).toBe(
      'select id from products',
    );
  });

  it('elfogadja a WITH ... SELECT-et (CTE)', () => {
    const sql =
      'WITH olcso AS (SELECT * FROM products WHERE price < 3000) SELECT name FROM olcso';

    expect(assertSelectOnly(sql)).toBe(sql);
  });

  it('levágja a lezáró pontosvesszőt', () => {
    expect(assertSelectOnly('SELECT 1;')).toBe('SELECT 1');
  });

  it('hibát dob üres bemenetre', () => {
    expect(() => assertSelectOnly('   ')).toThrow();
  });

  it('elutasítja az INSERT/UPDATE/DELETE-et', () => {
    expect(() => assertSelectOnly('DELETE FROM products')).toThrow();
    expect(() => assertSelectOnly('UPDATE products SET price = 0')).toThrow();
    expect(() =>
      assertSelectOnly("INSERT INTO products (name) VALUES ('x')"),
    ).toThrow();
  });

  it('elutasítja a DDL-t (DROP/ALTER/CREATE/TRUNCATE)', () => {
    expect(() => assertSelectOnly('DROP TABLE products')).toThrow();
    expect(() => assertSelectOnly('TRUNCATE products')).toThrow();
  });

  it('elutasítja a több utasítást (statement injection)', () => {
    expect(() => assertSelectOnly('SELECT 1; DROP TABLE products')).toThrow();
  });

  it('elutasítja a nem SELECT-tel kezdődő lekérdezést', () => {
    expect(() => assertSelectOnly('EXPLAIN SELECT * FROM products')).toThrow();
  });
});
