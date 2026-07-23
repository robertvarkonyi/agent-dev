import { describe, it, expect } from 'vitest';
import { retrieve } from '../retrieve.js';
import { FakeProviders } from '../../providers/providers.js';
import { UsageTracker } from '../../providers/usage.js';
import { InMemoryStore } from '../../storage/store.js';
import type { StoredChunk } from '../../storage/store.js';

async function seed(store: InMemoryStore, p: FakeProviders) {
  const docs = [
    {
      id: 'generic',
      text: 'monstera general care watering light soil repotting fertilizer',
    },
    { id: 'holes', text: 'why monstera leaves have holes fenestration splits' },
  ];

  for (const d of docs) {
    const [emb] = await p.embed([d.text]);
    const c: StoredChunk = {
      docId: d.id,
      title: d.id,
      source: `s/${d.id}`,
      category: 'c',
      headingPath: '',
      chunkIndex: 0,
      content: d.text,
      tokenCount: 1,
      embedding: emb,
      embedModel: 'fake',
      relatedDocs: [],
      contentHash: 'h',
    };

    await store.upsertDoc(d.id, [c]);
  }
}

describe('retrieve', () => {
  it('raw és full is ad találatot, a full rerankScore-t is', async () => {
    const store = new InMemoryStore();
    const p = new FakeProviders();
    await seed(store, p);
    const raw = await retrieve(
      'holes in monstera leaves',
      { providers: p, store },
      { mode: 'raw', topN: 5, topK: 2 },
    );

    const full = await retrieve(
      'holes in monstera leaves',
      { providers: p, store },
      { mode: 'full', topN: 5, topK: 2 },
    );

    expect(raw.length).toBeGreaterThan(0);
    expect(full[0].rerankScore).toBeGreaterThanOrEqual(
      full[1]?.rerankScore ?? 0,
    );
    expect(full[0].docId).toBe('holes'); // a rerank a pontosan releváns doksit hozza elöl
  });

  it('full módban a providerekbe fűzött tracker rögzíti a hyde/embedding/rerank funkciókat', async () => {
    const store = new InMemoryStore();
    const tracker = new UsageTracker();
    const p = new FakeProviders(tracker);
    await seed(store, p);

    await retrieve(
      'holes in monstera leaves',
      { providers: p, store },
      { mode: 'full', topN: 5, topK: 2 },
    );

    const fns = tracker.snapshot().map((u) => u.fn);

    expect(fns).toContain('hyde');
    expect(fns).toContain('embedding');
    expect(fns).toContain('rerank');
  });
});
