import { describe, it, expect } from 'vitest';
import { loadRagConfig } from '../config.js';

const base = {
  OPENAI_API_KEY: 'o',
  JINA_API_KEY: 'j',
  ANTHROPIC_API_KEY: 'a',
};

describe('loadRagConfig', () => {
  it('hiányzó OPENAI_API_KEY esetén beszédes magyar hibát dob', () => {
    expect(() => loadRagConfig({ ...base, OPENAI_API_KEY: '' })).toThrow(
      /OPENAI_API_KEY/,
    );
  });
  it('alapértelmezett modelleket és küszöböket ad', () => {
    const c = loadRagConfig(base);
    expect(c.embedModel).toBe('text-embedding-3-small');
    expect(c.rerankModel).toBe('jina-reranker-v2-base-multilingual');
    expect(c.minRerankScore).toBe(0.3);
    expect(c.topN).toBe(20);
    expect(c.topK).toBe(5);
  });
  it('env felülírja a defaultokat', () => {
    const c = loadRagConfig({
      ...base,
      RAG_TOP_K: '8',
      RAG_MIN_RERANK_SCORE: '0.5',
    });
    expect(c.topK).toBe(8);
    expect(c.minRerankScore).toBe(0.5);
  });
});
