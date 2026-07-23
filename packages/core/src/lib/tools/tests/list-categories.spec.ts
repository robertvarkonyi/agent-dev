import { describe, it, expect } from 'vitest';
import { extractCategories } from '../list-categories.js';

describe('extractCategories', () => {
  it('kinyeri és megőrzi a kategórianeveket a sorokból', () => {
    const rows = [
      { category: 'kaktusz' },
      { category: 'pozsgás' },
      { category: 'szobanövény' },
    ];
    expect(extractCategories(rows)).toEqual([
      'kaktusz',
      'pozsgás',
      'szobanövény',
    ]);
  });

  it('defenzíven dedupál', () => {
    const rows = [
      { category: 'kaktusz' },
      { category: 'kaktusz' },
      { category: 'fűszer' },
    ];
    expect(extractCategories(rows)).toEqual(['kaktusz', 'fűszer']);
  });

  it('kiszűri a nem-string / hiányzó category mezőt', () => {
    const rows = [
      { category: 'kaktusz' },
      { category: null },
      {},
      { category: 42 },
      { category: '' },
    ];
    expect(extractCategories(rows)).toEqual(['kaktusz']);
  });

  it('üres sorlistára üres tömb', () => {
    expect(extractCategories([])).toEqual([]);
  });
});
