import { describe, it, expect } from 'vitest';
import { answerFromKnowledge, NO_ANSWER } from '../answer.js';
import { FakeProviders, type Providers } from '../../providers/providers.js';
import { InMemoryStore } from '../../storage/store.js';
import type { StoredChunk } from '../../storage/store.js';

async function seed(
  store: InMemoryStore,
  p: FakeProviders,
  id: string,
  text: string,
) {
  const [emb] = await p.embed([text]);
  const c: StoredChunk = {
    docId: id,
    title: id,
    source: `s/${id}`,
    category: 'c',
    headingPath: '',
    chunkIndex: 0,
    content: text,
    tokenCount: 1,
    embedding: emb,
    embedModel: 'fake',
    relatedDocs: [],
    contentHash: 'h',
  };

  await store.upsertDoc(id, [c]);
}

describe('answerFromKnowledge', () => {
  it('találat esetén grounded válasz + forrás', async () => {
    const store = new InMemoryStore();
    const p = new FakeProviders();
    await seed(
      store,
      p,
      'snake',
      'snake plant water every two weeks bright indirect light',
    );
    const r = await answerFromKnowledge(
      'how often water snake plant',
      { providers: p, store },
      { topN: 5, topK: 3, minRerankScore: 0.05 },
    );

    expect(r.grounded).toBe(true);
    expect(r.sources[0].source).toBe('s/snake');
    expect(r.answer).not.toBe(NO_ANSWER);
  });
  it('küszöb alatt → nincs kitalálás (1. réteg: retrieval-kapu)', async () => {
    const store = new InMemoryStore();
    const p = new FakeProviders();
    await seed(store, p, 'snake', 'snake plant care');
    const r = await answerFromKnowledge(
      'venus flytrap carnivorous plant care',
      { providers: p, store },
      { topN: 5, topK: 3, minRerankScore: 0.9 },
    );

    expect(r.grounded).toBe(false);
    expect(r.answer).toBe(NO_ANSWER);
    expect(r.sources).toEqual([]);
  });

  it('kapu átengedi, de az LLM elutasít → grounded:false, nincs forrás (2. réteg: prompt-szabály)', async () => {
    const store = new InMemoryStore();
    const p = new FakeProviders();
    await seed(store, p, 'snake', 'snake plant care');

    // A kapu átengedi (küszöb=0.05), így az answer() valóban lefut — de az LLM a NO_ANSWER-rel
    // kezdett elutasítást ad vissza. A prototípus-metódusok bind-olva kellenek (osztály-példány
    // spreadje nem másolná őket).
    const refusing: Providers = {
      embed: p.embed.bind(p),
      hyde: p.hyde.bind(p),
      rerank: p.rerank.bind(p),
      answer: async () =>
        `${NO_ANSWER} A források csak a kígyónövényről szólnak.`,
    };

    const r = await answerFromKnowledge(
      'snake plant care',
      { providers: refusing, store },
      { topN: 5, topK: 3, minRerankScore: 0.05 },
    );

    expect(r.grounded).toBe(false);
    expect(r.answer.startsWith(NO_ANSWER)).toBe(true);
    expect(r.sources).toEqual([]);
  });

  it('idézőjelbe csomagolt elutasítást is felismer (a modell néha átveszi a promptbeli idézőjelet)', async () => {
    const store = new InMemoryStore();
    const p = new FakeProviders();
    await seed(store, p, 'snake', 'snake plant care');

    // Éles esetben előfordult: az LLM idézőjelbe tette a mondatot → a naiv trim().startsWith()
    // elhasalt a vezető `"`-n, és tévesen grounded=true-t adott.
    const refusing: Providers = {
      embed: p.embed.bind(p),
      hyde: p.hyde.bind(p),
      rerank: p.rerank.bind(p),
      answer: async () =>
        `"${NO_ANSWER}" A források pókfű és pothos gondozását fedik le.`,
    };

    const r = await answerFromKnowledge(
      'venus flytrap care',
      { providers: refusing, store },
      { topN: 5, topK: 3, minRerankScore: 0.05 },
    );

    expect(r.grounded).toBe(false);
    expect(r.sources).toEqual([]);
  });
});
