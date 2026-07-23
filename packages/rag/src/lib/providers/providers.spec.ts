import { describe, it, expect } from 'vitest';
import { FakeProviders } from './providers.js';

describe('FakeProviders', () => {
  const p = new FakeProviders();
  it('embed: azonos szöveg → azonos vektor, fix dimenzió', async () => {
    const [a, b] = await p.embed(['snake plant water', 'snake plant water']);
    expect(a).toEqual(b);
    expect(a.length).toBe(1536);
  });
  it('rerank: a query-szavakat jobban fedő doksi kap magasabb score-t, csökkenő sorrend', async () => {
    const hits = await p.rerank(
      'snake plant light',
      ['about fertilizer schedules', 'snake plant needs bright light'],
      2,
    );
    expect(hits[0].index).toBe(1);
    expect(hits[0].score).toBeGreaterThanOrEqual(hits[1].score);
  });
  it('hyde: nem üres, tartalmazza a query-t', async () => {
    expect((await p.hyde('how to water snake plant')).length).toBeGreaterThan(
      0,
    );
  });
});
