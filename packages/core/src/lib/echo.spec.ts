import { describe, it, expect } from 'vitest';
import { echo } from './echo';

describe('echo', () => {
  it('visszaadja a beírt szöveget', () => {
    expect(echo('hány pozsgás van raktáron?')).toBe('hány pozsgás van raktáron?');
  });

  it('levágja a körülvevő whitespace-t', () => {
    expect(echo('  szia  ')).toBe('szia');
  });

  it('hibát dob üres vagy csak whitespace bemenetre', () => {
    expect(() => echo('   ')).toThrow();
  });
});
