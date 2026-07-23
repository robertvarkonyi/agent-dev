import { Pool } from 'pg';
import type { Chunk } from '../chunking/chunker.js';

export interface StoredChunk extends Chunk {
  embedding: number[];
  embedModel: string;
  relatedDocs: string[];
  contentHash: string;
}

export interface SearchHit {
  docId: string;
  title: string;
  source: string;
  category: string;
  headingPath: string;
  content: string;
  distance: number;
}

export interface Store {
  upsertDoc(docId: string, chunks: StoredChunk[]): Promise<void>;
  similaritySearch(embedding: number[], topN: number): Promise<SearchHit[]>;
  deleteByDocId(docId: string): Promise<void>;
  docHashes(): Promise<Map<string, string>>;
}

export const toVectorLiteral = (v: number[]): string => `[${v.join(',')}]`;

const cosineDistance = (a: number[], b: number[]): number => {
  let dot = 0,
    na = 0,
    nb = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }

  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};

export class InMemoryStore implements Store {
  private byDoc = new Map<string, StoredChunk[]>();

  async upsertDoc(docId: string, chunks: StoredChunk[]): Promise<void> {
    this.byDoc.set(docId, chunks);
  }

  async deleteByDocId(docId: string): Promise<void> {
    this.byDoc.delete(docId);
  }

  async docHashes(): Promise<Map<string, string>> {
    const m = new Map<string, string>();

    for (const [id, cs] of this.byDoc) {
      if (cs[0]) {
        m.set(id, cs[0].contentHash);
      }
    }

    return m;
  }

  async similaritySearch(
    embedding: number[],
    topN: number,
  ): Promise<SearchHit[]> {
    const all: SearchHit[] = [];

    for (const cs of this.byDoc.values()) {
      for (const c of cs) {
        all.push({
          docId: c.docId,
          title: c.title,
          source: c.source,
          category: c.category,
          headingPath: c.headingPath,
          content: c.content,
          distance: cosineDistance(embedding, c.embedding),
        });
      }
    }

    return all.sort((a, b) => a.distance - b.distance).slice(0, topN);
  }
}

interface KnowledgeChunkRow {
  doc_id: string;
  doc_title: string;
  doc_source: string;
  doc_category: string;
  heading_path: string;
  content: string;
  distance: number | string;
}

export class PgStore implements Store {
  constructor(private pool: Pool) {}

  async upsertDoc(docId: string, chunks: StoredChunk[]): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM knowledge_chunks WHERE doc_id = $1', [
        docId,
      ]);

      for (const c of chunks) {
        await client.query(
          `INSERT INTO knowledge_chunks
             (doc_id, doc_title, doc_source, doc_category, heading_path, chunk_index,
              content, content_hash, related_docs, token_count, embedding, embed_model)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::vector,$12)`,
          [
            c.docId,
            c.title,
            c.source,
            c.category,
            c.headingPath,
            c.chunkIndex,
            c.content,
            c.contentHash,
            c.relatedDocs,
            c.tokenCount,
            toVectorLiteral(c.embedding),
            c.embedModel,
          ],
        );
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async deleteByDocId(docId: string): Promise<void> {
    await this.pool.query('DELETE FROM knowledge_chunks WHERE doc_id = $1', [
      docId,
    ]);
  }

  async docHashes(): Promise<Map<string, string>> {
    const r = await this.pool.query<{ doc_id: string; content_hash: string }>(
      'SELECT DISTINCT ON (doc_id) doc_id, content_hash FROM knowledge_chunks ORDER BY doc_id, chunk_index',
    );

    return new Map(r.rows.map((row) => [row.doc_id, row.content_hash]));
  }

  async similaritySearch(
    embedding: number[],
    topN: number,
  ): Promise<SearchHit[]> {
    const r = await this.pool.query<KnowledgeChunkRow>(
      `SELECT doc_id, doc_title, doc_source, doc_category, heading_path, content,
              embedding <=> $1::vector AS distance
         FROM knowledge_chunks ORDER BY embedding <=> $1::vector LIMIT $2`,
      [toVectorLiteral(embedding), topN],
    );

    return r.rows.map((row) => ({
      docId: row.doc_id,
      title: row.doc_title,
      source: row.doc_source,
      category: row.doc_category,
      headingPath: row.heading_path,
      content: row.content,
      distance: Number(row.distance),
    }));
  }
}
