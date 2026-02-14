import { randomUUID } from "node:crypto";
import { chunkText } from "../chunking.js";

export interface IngestRequest {
  collection?: string;
  items: IngestItem[];
}

export interface IngestItem {
  id?: string;
  text: string;
  source: string;
  metadata?: Record<string, unknown>;
}

export interface IngestResult {
  ok: true;
  upserted: number;
}

export interface QdrantPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

export interface IngestDeps {
  embed: (texts: string[]) => Promise<number[][]>;
  ensureCollection: (name: string) => Promise<void>;
  upsert: (collection: string, points: QdrantPoint[]) => Promise<void>;
  collectionName: (name?: string) => string;
}

export async function ingest(
  request: IngestRequest,
  deps: IngestDeps,
): Promise<IngestResult> {
  const col = deps.collectionName(request.collection);
  await deps.ensureCollection(col);

  const points: QdrantPoint[] = [];
  for (const item of request.items) {
    const baseId = item.id ?? randomUUID();
    const chunks = chunkText(item.text);
    const vectors = await deps.embed(chunks);

    for (let i = 0; i < chunks.length; i++) {
      points.push({
        id: `${baseId}:${i}`,
        vector: vectors[i],
        payload: {
          text: chunks[i],
          source: item.source,
          chunkIndex: i,
          ...(item.metadata ?? {}),
        },
      });
    }
  }

  await deps.upsert(col, points);
  return { ok: true, upserted: points.length };
}
