import { createHash } from 'node:crypto';
import { parseDoc } from './markdown.js';
import { chunkDoc, extractRelated, resolveRelated } from './chunker.js';
import type { Providers } from './providers.js';
import type { Store, StoredChunk } from './store.js';

export const hashBody = (body: string): string =>
  createHash('sha256').update(body).digest('hex');

export interface IngestResult {
  indexed: number;
  skipped: number;
  deleted: number;
}

// Folyamat-esemény a hívónak (a CLI ebből ír progress-sorokat). UI-független: a RAG-csomag nem
// ismer console-t, csak a callbacket hívja.
export type IngestProgress =
  | { type: 'deleted'; docId: string }
  | {
      type: 'doc';
      index: number;
      total: number;
      docId: string;
      action: 'indexed' | 'skipped';
      chunks: number;
    };

export async function ingestDocs(
  files: { docId: string; raw: string }[],
  deps: {
    providers: Providers;
    store: Store;
    embedModel: string;
    onProgress?: (event: IngestProgress) => void;
  },
): Promise<IngestResult> {
  const { providers, store, embedModel, onProgress } = deps;
  const existing = await store.docHashes();
  const titleToDocId = new Map<string, string>();
  const parsed = files.map((f) => {
    const doc = parseDoc(f.raw, f.docId);
    titleToDocId.set(doc.title.toLowerCase().trim(), f.docId);
    return { file: f, doc };
  });

  let indexed = 0,
    skipped = 0,
    deleted = 0;
  const present = new Set(files.map((f) => f.docId));
  for (const docId of existing.keys())
    if (!present.has(docId)) {
      await store.deleteByDocId(docId);
      deleted++;
      onProgress?.({ type: 'deleted', docId });
    }

  const total = parsed.length;
  let index = 0;
  for (const { doc } of parsed) {
    index++;
    const hash = hashBody(doc.body);
    if (existing.get(doc.docId) === hash) {
      skipped++;
      onProgress?.({
        type: 'doc',
        index,
        total,
        docId: doc.docId,
        action: 'skipped',
        chunks: 0,
      });
      continue;
    }
    // A "Learn More" cross-refeket feloldjuk és eltároljuk (related_docs oszlop), de v1-ben
    // query-időben MÉG NEM olvassuk vissza (mint az embed_model) — lásd docs/RAG/ARCHITEKTURA.md
    // "related_docs [TERV]" szekció: jövőbeli testvér-doksi bővítés / cikk-család hivatkozás.
    const relatedDocs = resolveRelated(extractRelated(doc.body), titleToDocId);
    const chunks = chunkDoc(doc);
    if (chunks.length === 0) {
      skipped++;
      onProgress?.({
        type: 'doc',
        index,
        total,
        docId: doc.docId,
        action: 'skipped',
        chunks: 0,
      });
      continue;
    }
    const embeddings = await providers.embed(chunks.map((c) => c.content));
    const stored: StoredChunk[] = chunks.map((c, i) => ({
      ...c,
      embedding: embeddings[i],
      embedModel,
      relatedDocs,
      contentHash: hash,
    }));
    await store.upsertDoc(doc.docId, stored);
    indexed++;
    onProgress?.({
      type: 'doc',
      index,
      total,
      docId: doc.docId,
      action: 'indexed',
      chunks: chunks.length,
    });
  }
  return { indexed, skipped, deleted };
}
