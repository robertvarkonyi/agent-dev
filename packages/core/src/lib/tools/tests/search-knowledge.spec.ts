import { describe, it, expect } from 'vitest';
import { buildSearchKnowledge } from '../search-knowledge.js';

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
  // Az execute SOSEM dobhat (a dobott Error üres tool_result → Anthropic 400). Ha az answer-függvény
  // dob (pl. hiányzó kulcs/DB), a tool beszédes, NEM üres hibaszöveget ad vissza — nem reject-el.
  it('ha az answer dob, beszédes hibaszöveget ad vissza (nem reject)', async () => {
    const fakeAnswer = async () => {
      throw new Error('nincs OPENAI_API_KEY');
    };

    const tool = buildSearchKnowledge(fakeAnswer as any);
    const out = await tool.execute!({ query: 'x' }, {} as any);
    expect(typeof out).toBe('string');
    expect(out as string).toContain('Hiba');
    expect(out as string).toContain('nincs OPENAI_API_KEY');
  });
});
