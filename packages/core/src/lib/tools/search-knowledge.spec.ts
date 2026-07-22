import { describe, it, expect } from 'vitest';
import { buildSearchKnowledge } from './search-knowledge.js';

describe('buildSearchKnowledge', () => {
  it('a grounded választ + forrásokat adja vissza a modellnek', async () => {
    const fakeAnswer = async () => ({
      answer: 'Kéthetente öntözd.',
      grounded: true,
      sources: [{ title: 'Snake', source: 's/snake' }],
    });
    const tool = buildSearchKnowledge(fakeAnswer as any);
    const out = await tool.execute!({ query: 'öntözés?' }, {} as any);
    expect(out).toMatchObject({ grounded: true });
    expect(JSON.stringify(out)).toContain('s/snake');
  });
  it('nincs találatkor grounded:false', async () => {
    const fakeAnswer = async () => ({
      answer: 'Erről nincs információ a Plantbase tudásbázisban.',
      grounded: false,
      sources: [],
    });
    const tool = buildSearchKnowledge(fakeAnswer as any);
    const out = await tool.execute!({ query: 'x' }, {} as any);
    expect(out).toMatchObject({ grounded: false });
  });
});
