import { QdrantClient } from "@qdrant/js-client-rest";

const QDRANT_URL = process.env.QDRANT_URL || "http://qdrant:6333";
const DEFAULT_COLLECTION = process.env.QDRANT_COLLECTION || "docs";
const VECTOR_SIZE = Number(process.env.VECTOR_SIZE || "768");

type DistanceMetric = "Cosine" | "Euclid" | "Dot";

const VALID_DISTANCES: DistanceMetric[] = ["Cosine", "Euclid", "Dot"];

function getDistance(): DistanceMetric {
  const envDistance = process.env.DISTANCE;
  if (envDistance && (VALID_DISTANCES as readonly string[]).includes(envDistance)) {
    return envDistance as DistanceMetric;
  }
  return "Cosine";
}

const DISTANCE: DistanceMetric = getDistance();

export const qdrant = new QdrantClient({ url: QDRANT_URL });

export async function ensureCollection(name = DEFAULT_COLLECTION) {
  const collections = await qdrant.getCollections();
  const exists = collections.collections?.some((c) => c.name === name);
  if (exists) return;
  await qdrant.createCollection(name, { vectors: { size: VECTOR_SIZE, distance: DISTANCE } });
}

export function collectionName(name?: string) {
  return name || DEFAULT_COLLECTION;
}
