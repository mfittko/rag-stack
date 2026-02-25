import { describe, it, expect, vi, beforeEach } from "vitest";
import { queryMetadata } from "./query-metadata.js";

vi.mock("../db.js", () => ({
  getPool: vi.fn(() => ({
    query: vi.fn(async () => ({
      rows: [
        {
          chunk_id: "doc1:0",
          text: "some chunk text",
          source: "doc1.md",
          chunk_index: 0,
          base_id: "doc1",
          doc_type: "text",
          repo_id: null,
          repo_url: null,
          path: null,
          lang: null,
          item_url: null,
          tier1_meta: {},
          tier2_meta: null,
          tier3_meta: null,
          doc_summary: null,
          doc_summary_short: null,
          doc_summary_medium: null,
          doc_summary_long: null,
          payload_checksum: null,
        },
      ],
    })),
  })),
}));

// Verify embed is never called by ensuring the module is not imported/used
vi.mock("../embeddings.js", () => ({
  embed: vi.fn(() => {
    throw new Error("embed() must not be called in the metadata-only path");
  }),
}));

describe("queryMetadata service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok: true with results", async () => {
    const result = await queryMetadata({ collection: "docs" });
    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(1);
  });

  it("returns score 1.0 for all results", async () => {
    const result = await queryMetadata({ collection: "docs" });
    for (const item of result.results) {
      expect(item.score).toBe(1.0);
    }
  });

  it("SQL contains ORDER BY c.created_at DESC", async () => {
    const { getPool } = await import("../db.js");
    const queryMock = vi.fn(async () => ({ rows: [] }));
    (getPool as ReturnType<typeof vi.fn>).mockReturnValueOnce({ query: queryMock });

    await queryMetadata({ collection: "docs", topK: 5 });

    const [sql] = queryMock.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("ORDER BY c.created_at DESC");
  });

  it("SQL LIMIT equals topK", async () => {
    const { getPool } = await import("../db.js");
    const queryMock = vi.fn(async () => ({ rows: [] }));
    (getPool as ReturnType<typeof vi.fn>).mockReturnValueOnce({ query: queryMock });

    await queryMetadata({ collection: "docs", topK: 12 });

    const [, params] = queryMock.mock.calls[0] as unknown as [string, unknown[]];
    // params[1] is topK ($2)
    expect(params[1]).toBe(12);
  });

  it("SQL contains document-level filter when filter provided", async () => {
    const { getPool } = await import("../db.js");
    const queryMock = vi.fn(async () => ({ rows: [] }));
    (getPool as ReturnType<typeof vi.fn>).mockReturnValueOnce({ query: queryMock });

    await queryMetadata({
      collection: "docs",
      filter: {
        conditions: [{ field: "ingestedAt", op: "gte", value: "2025-01-01T00:00:00Z", alias: "d" }],
      } as unknown as Record<string, unknown>,
    });

    const [sql] = queryMock.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("d.ingested_at >= $3");
  });

  it("uses default collection 'docs' when not provided", async () => {
    const { getPool } = await import("../db.js");
    const queryMock = vi.fn(async () => ({ rows: [] }));
    (getPool as ReturnType<typeof vi.fn>).mockReturnValueOnce({ query: queryMock });

    await queryMetadata({});

    const [, params] = queryMock.mock.calls[0] as unknown as [string, unknown[]];
    expect(params[0]).toBe("docs");
  });

  it("returns full QueryResultItem payload shape", async () => {
    const { getPool } = await import("../db.js");
    const queryMock = vi.fn(async () => ({
      rows: [
        {
          chunk_id: "doc1:0",
          text: "text",
          source: "doc1.md",
          chunk_index: 0,
          base_id: "doc1",
          doc_type: "text",
          repo_id: "repo1",
          repo_url: null,
          path: "/src",
          lang: "ts",
          item_url: null,
          tier1_meta: {},
          tier2_meta: null,
          tier3_meta: null,
          doc_summary: "A summary",
          doc_summary_short: null,
          doc_summary_medium: null,
          doc_summary_long: null,
          payload_checksum: "abc123",
        },
      ],
    }));
    (getPool as ReturnType<typeof vi.fn>).mockReturnValueOnce({ query: queryMock });

    const result = await queryMetadata({ collection: "docs" });
    const item = result.results[0];
    expect(item.id).toBe("doc1:0");
    expect(item.source).toBe("doc1.md");
    expect(item.text).toBe("text");
    expect(item.payload?.repoId).toBe("repo1");
    expect(item.payload?.docSummary).toBe("A summary");
    expect(item.payload?.payloadChecksum).toBe("abc123");
  });
});
