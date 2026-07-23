import { describe, it, expect } from 'vitest';
import { ingestDocs, type IngestProgress } from './ingest.js';
import { FakeProviders } from '../providers/providers.js';
import { InMemoryStore } from '../storage/store.js';

const FM = (t: string, b: string) =>
  `---\ntitle: ${t}\nsource: s/${t}\ncategory: c\n---\n## H\n${b}`;

describe('ingestDocs', () => {
  it('beindexeli az összes doksit, majd változatlanul újrafuttatva mind skip', async () => {
    const files = [
      { docId: 'a', raw: FM('A', 'apple text') },
      { docId: 'b', raw: FM('B', 'banana text') },
    ];
    const deps = {
      providers: new FakeProviders(),
      store: new InMemoryStore(),
      embedModel: 'fake',
    };
    const r1 = await ingestDocs(files, deps);
    expect(r1.indexed).toBe(2);
    const r2 = await ingestDocs(files, deps);
    expect(r2.skipped).toBe(2);
    expect(r2.indexed).toBe(0);
  });
  it('törli a filesystemből eltűnt doksi chunkjait', async () => {
    const store = new InMemoryStore();
    const deps = { providers: new FakeProviders(), store, embedModel: 'fake' };
    await ingestDocs(
      [
        { docId: 'a', raw: FM('A', 'x') },
        { docId: 'b', raw: FM('B', 'y') },
      ],
      deps,
    );
    const r = await ingestDocs([{ docId: 'a', raw: FM('A', 'x') }], deps); // 'b' eltűnt
    expect(r.deleted).toBe(1);
    expect((await store.docHashes()).has('b')).toBe(false);
  });

  it('onProgress: minden doksira index/total + action eseményt ad (indexelt, majd skip)', async () => {
    const store = new InMemoryStore();
    const events: IngestProgress[] = [];
    const deps = {
      providers: new FakeProviders(),
      store,
      embedModel: 'fake',
      onProgress: (e: IngestProgress) => events.push(e),
    };
    const files = [
      { docId: 'a', raw: FM('A', 'apple') },
      { docId: 'b', raw: FM('B', 'banana') },
    ];
    await ingestDocs(files, deps);
    const docEvents = events.filter((e) => e.type === 'doc');
    expect(docEvents).toHaveLength(2);
    expect(docEvents[0]).toMatchObject({
      index: 1,
      total: 2,
      action: 'indexed',
    });
    expect(docEvents[1]).toMatchObject({
      index: 2,
      total: 2,
      action: 'indexed',
    });

    // Újrafuttatva mind 'skipped', a törölt doksi 'deleted' eseményt ad.
    events.length = 0;
    await ingestDocs([{ docId: 'a', raw: FM('A', 'apple') }], deps); // 'b' eltűnt
    expect(events).toContainEqual({ type: 'deleted', docId: 'b' });
    expect(events.some((e) => e.type === 'doc' && e.action === 'skipped')).toBe(
      true,
    );
  });
});
