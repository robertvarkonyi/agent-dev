import { describe, it, expect } from 'vitest';
import { GOLDEN_QUESTIONS, runGolden, renderGoldenMarkdown } from './golden.js';
import { FakeProviders } from './providers.js';
import { InMemoryStore } from './store.js';
import type { StoredChunk } from './store.js';

describe('golden', () => {
  it('legalább 8 kérdés, van megválaszolhatatlan (Vénusz légycsapó)', () => {
    expect(GOLDEN_QUESTIONS.length).toBeGreaterThanOrEqual(8);
    expect(GOLDEN_QUESTIONS.some((q) => /légycsapó|flytrap/i.test(q.q))).toBe(
      true,
    );
  });
  it('runGolden minden kérdésre ad raw+full sort, és markdownt renderel', async () => {
    const store = new InMemoryStore();
    const p = new FakeProviders();
    const [emb] = await p.embed(['snake plant water light']);
    const c: StoredChunk = {
      docId: 'snake',
      title: 'Snake',
      source: 's/snake',
      category: 'c',
      headingPath: '',
      chunkIndex: 0,
      content: 'snake plant water light',
      tokenCount: 1,
      embedding: emb,
      embedModel: 'fake',
      relatedDocs: [],
      contentHash: 'h',
    };
    await store.upsertDoc('snake', [c]);
    const rep = await runGolden(
      { providers: p, store },
      { topN: 5, topK: 3, minRerankScore: 0.05 },
    );
    expect(rep.rows.length).toBe(GOLDEN_QUESTIONS.length);
    expect(renderGoldenMarkdown(rep)).toMatch(/raw|full/i);
  });
});
