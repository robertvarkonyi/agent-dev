-- CreateExtension
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" BIGSERIAL NOT NULL,
    "doc_id" TEXT NOT NULL,
    "doc_title" TEXT NOT NULL,
    "doc_source" TEXT NOT NULL,
    "doc_category" TEXT NOT NULL,
    "heading_path" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "related_docs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "token_count" INTEGER NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "embed_model" TEXT NOT NULL,
    "indexed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_chunks_doc_id_idx" ON "knowledge_chunks"("doc_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_doc_id_chunk_index_key" ON "knowledge_chunks"("doc_id", "chunk_index");

-- CreateIndex (HNSW, cosine)
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_hnsw
  ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);

-- GrantSelect (RO role a knowledge_chunks táblára)
GRANT SELECT ON knowledge_chunks TO plantbase_ro;
