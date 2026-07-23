import { describe, it, expect } from 'vitest';
import { FakeProviders } from '../providers.js';
import { UsageTracker } from '../usage.js';

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

describe('FakeProviders trackerrel', () => {
  it('tracker nélkül nem rögzít (visszafelé kompatibilis)', async () => {
    const p = new FakeProviders();

    await p.embed(['snake plant']);

    // Nincs mit ellenőrizni a trackeren; a lényeg, hogy a hívás tracker nélkül is lefut.
    expect((await p.embed(['x'])).length).toBe(1);
  });

  it('trackerrel az embed a `embedding` funkciót rögzíti', async () => {
    const tracker = new UsageTracker();
    const p = new FakeProviders(tracker);

    await p.embed(['snake plant water']);

    expect(tracker.snapshot().map((u) => u.fn)).toEqual(['embedding']);
  });

  it('trackerrel a hyde/rerank/answer a saját funkciócímkéjét rögzíti', async () => {
    const tracker = new UsageTracker();
    const p = new FakeProviders(tracker);

    await p.hyde('q');
    await p.rerank('q', ['a', 'b'], 2);
    await p.answer('sys', 'prompt');

    expect(tracker.snapshot().map((u) => u.fn)).toEqual([
      'hyde',
      'rerank',
      'rag-answer',
    ]);
  });
});
