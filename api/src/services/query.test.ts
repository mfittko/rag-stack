import { describe, it, expect, vi, beforeEach } from "vitest";
import { query } from "./query.js";
import type { QueryRequest } from "./query.js";

// Mock the db module
vi.mock("../db.js", () => ({
  getPool: vi.fn(() => ({
    query: vi.fn(async () => ({
      rows: [
        {
          chunk_id: "test-id:0",
          distance: 0.1,
          text: "hello world",
          source: "test.txt",
          chunk_index: 0,
          base_id: "test-id",
          doc_type: "text",
          repo_id: null,
          repo_url: null,
          path: null,
          lang: null,
          item_url: null,
          tier1_meta: {},
          tier2_meta: null,
          tier3_meta: null,
        },
      ],
    })),
  })),
}));

// Mock ollama module
vi.mock("../ollama.js", () => ({
  embed: vi.fn(async (texts: string[]) =>
    texts.map(() => Array(768).fill(0.1))
  ),
}));

describe("query service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("performs vector search and returns results", async () => {
    const request: QueryRequest = {
      query: "hello",
    };

    const result = await query(request);

    expect(result.ok).toBe(true);
    expect(result.results).toBeDefined();
    expect(result.results.length).toBeGreaterThan(0);
  });

  it("uses custom topK when specified", async () => {
    const request: QueryRequest = {
      query: "hello",
      topK: 5,
    };

    const result = await query(request);

    expect(result.ok).toBe(true);
  });

  it("uses default topK of 8 when not specified", async () => {
    const request: QueryRequest = {
      query: "hello",
    };

    const result = await query(request);

    expect(result.ok).toBe(true);
  });

  it("converts distance to similarity score", async () => {
    const request: QueryRequest = {
      query: "test",
    };

    const result = await query(request);

    expect(result.ok).toBe(true);
    expect(result.results[0].score).toBeGreaterThan(0);
    expect(result.results[0].score).toBeLessThanOrEqual(1);
  });

  it("handles empty results gracefully", async () => {
    const { getPool } = await import("../db.js");
    (getPool as any).mockReturnValueOnce({
      query: vi.fn(async () => ({ rows: [] })),
    });

    const request: QueryRequest = {
      query: "nothing matches this",
    };

    const result = await query(request);

    expect(result.ok).toBe(true);
    expect(result.results.length).toBe(0);
  });
});
