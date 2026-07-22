import { describe, it, expect } from 'vitest';
import { InMemoryStore, toVectorLiteral } from './store.js';
import type { StoredChunk } from './store.js';

const chunk = (
  docId: string,
  content: string,
  embedding: number[],
): StoredChunk => ({
  docId,
  title: docId,
  source: `src/${docId}`,
  category: 'c',
  headingPath: '',
  chunkIndex: 0,
  content,
  tokenCount: 1,
  embedding,
  embedModel: 'fake',
  relatedDocs: [],
  contentHash: 'h',
});

describe('toVectorLiteral', () => {
  it('pgvector-literált ad', () =>
    expect(toVectorLiteral([1, 0.5])).toBe('[1,0.5]'));
});

describe('InMemoryStore', () => {
  it('similaritySearch a legközelebbi vektort adja elöl', async () => {
    const s = new InMemoryStore();
    await s.upsertDoc('a', [chunk('a', 'apple', [1, 0, 0])]);
    await s.upsertDoc('b', [chunk('b', 'banana', [0, 1, 0])]);
    const hits = await s.similaritySearch([0.9, 0.1, 0], 2);
    expect(hits[0].docId).toBe('a');
  });
  it('upsertDoc ugyanarra a docId-ra cserél (nem duplikál)', async () => {
    const s = new InMemoryStore();
    await s.upsertDoc('a', [chunk('a', 'v1', [1, 0, 0])]);
    await s.upsertDoc('a', [chunk('a', 'v2', [1, 0, 0])]);
    const hits = await s.similaritySearch([1, 0, 0], 5);
    expect(hits.filter((h) => h.docId === 'a').length).toBe(1);
    expect(hits[0].content).toBe('v2');
  });
  it('deleteByDocId + docHashes', async () => {
    const s = new InMemoryStore();
    await s.upsertDoc('a', [chunk('a', 'x', [1, 0, 0])]);
    expect((await s.docHashes()).get('a')).toBe('h');
    await s.deleteByDocId('a');
    expect((await s.docHashes()).size).toBe(0);
  });
});
