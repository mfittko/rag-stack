-- Migration 007: Add B-tree indexes for temporal and MIME-type columns
-- Required for efficient metadata-only query filtering (strategy: "metadata")

CREATE INDEX IF NOT EXISTS idx_documents_ingested_at ON documents (ingested_at);
CREATE INDEX IF NOT EXISTS idx_documents_updated_at  ON documents (updated_at);
CREATE INDEX IF NOT EXISTS idx_documents_last_seen   ON documents (last_seen);
CREATE INDEX IF NOT EXISTS idx_documents_mime_type   ON documents (mime_type);
CREATE INDEX IF NOT EXISTS idx_chunks_created_at     ON chunks    (created_at);
