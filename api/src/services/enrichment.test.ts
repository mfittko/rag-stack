import { describe, it, expect, vi, beforeEach } from "vitest";
import { getEnrichmentStatus, getEnrichmentStats, enqueueEnrichment, clearEnrichmentQueue } from "./enrichment.js";

// Mock the db module
vi.mock("../db.js", () => ({
  getPool: vi.fn(() => ({
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM chunks c")) {
        // getEnrichmentStatus query
        return {
          rows: [
            {
              enrichment_status: "enriched",
              enriched_at: new Date().toISOString(),
              tier2_meta: { entities: [] },
              tier3_meta: null,
            },
          ],
        };
      } else if (sql.includes("FROM task_queue")) {
        // getEnrichmentStats query
        return {
          rows: [
            { status: "pending", count: 10 },
            { status: "processing", count: 2 },
          ],
        };
      } else if (sql.includes("FROM chunks")) {
        // getEnrichmentStats chunks query
        return {
          rows: [
            { enrichment_status: "enriched", count: 50 },
            { enrichment_status: "pending", count: 10 },
          ],
        };
      } else if (sql.includes("SELECT") && sql.includes("chunk_id")) {
        // enqueueEnrichment query
        return {
          rows: [
            {
              chunk_id: "test-id:0",
              base_id: "test-id",
              chunk_index: 0,
              text: "test",
              source: "test.txt",
              doc_type: "text",
              tier1_meta: {},
            },
          ],
        };
      }
      return { rows: [] };
    }),
    connect: vi.fn(async () => ({
      query: vi.fn(async () => ({ rows: [] })),
      release: vi.fn(),
    })),
  })),
}));

describe("enrichment service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getEnrichmentStatus", () => {
    it("returns status for a document", async () => {
      const result = await getEnrichmentStatus({ baseId: "test-id" });

      expect(result.baseId).toBe("test-id");
      expect(result.status).toBeDefined();
      expect(result.chunks).toBeDefined();
    });

    it("throws 404 when document not found", async () => {
      const { getPool } = await import("../db.js");
      (getPool as any).mockReturnValueOnce({
        query: vi.fn(async () => ({ rows: [] })),
      });

      await expect(
        getEnrichmentStatus({ baseId: "nonexistent" })
      ).rejects.toThrow();
    });

    it("returns mixed status when chunks have different states", async () => {
      const { getPool } = await import("../db.js");
      (getPool as any).mockReturnValueOnce({
        query: vi.fn(async () => ({
          rows: [
            {
              enrichment_status: "enriched",
              enriched_at: new Date().toISOString(),
              tier2_meta: null,
              tier3_meta: null,
            },
            {
              enrichment_status: "pending",
              enriched_at: null,
              tier2_meta: null,
              tier3_meta: null,
            },
          ],
        })),
      });

      const result = await getEnrichmentStatus({ baseId: "mixed-id" });
      expect(result.status).toBe("mixed");
      expect(result.chunks.total).toBe(2);
    });

    it("extracts error metadata from tier3_meta._error on failed chunks", async () => {
      const { getPool } = await import("../db.js");
      (getPool as any).mockReturnValueOnce({
        query: vi.fn(async () => ({
          rows: [
            {
              enrichment_status: "failed",
              enriched_at: null,
              tier2_meta: null,
              tier3_meta: {
                _error: {
                  message: "Test error",
                  taskId: "task-123",
                  attempt: 3,
                  maxAttempts: 3,
                  final: true,
                  failedAt: "2024-01-01T00:00:00Z",
                  chunkIndex: 0,
                },
              },
            },
          ],
        })),
      });

      const result = await getEnrichmentStatus({ baseId: "failed-id" });
      expect(result.status).toBe("failed");
      expect(result.metadata?.error).toBeDefined();
      expect(result.metadata?.error?.message).toBe("Test error");
      expect(result.metadata?.error?.taskId).toBe("task-123");
      expect(result.metadata?.error?.attempt).toBe(3);
      expect(result.metadata?.error?.final).toBe(true);
    });
  });

  describe("getEnrichmentStats", () => {
    it("returns queue and chunk statistics", async () => {
      const result = await getEnrichmentStats();

      expect(result.queue).toBeDefined();
      expect(result.totals).toBeDefined();
    });

    it("applies filter to queue and chunk statistics", async () => {
      const { getPool } = await import("../db.js");
      const mockQuery = vi.fn(async (sql: string) => {
        if (sql.includes("FROM task_queue")) {
          return {
            rows: [
              { status: "pending", count: 5 },
            ],
          };
        } else if (sql.includes("FROM chunks c")) {
          return {
            rows: [
              { enrichment_status: "enriched", count: 25 },
            ],
          };
        }
        return { rows: [] };
      });

      (getPool as any).mockReturnValueOnce({
        query: mockQuery,
      });

      const result = await getEnrichmentStats({ filter: "test filter", collection: "docs" });

      expect(result.queue).toBeDefined();
      expect(result.totals).toBeDefined();

      // Verify filter was applied in SQL
      const calls = mockQuery.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const queueQuery = calls.find((c: any) => c[0].includes("FROM task_queue"));
      expect(queueQuery).toBeDefined();
      expect(queueQuery![0]).toContain("websearch_to_tsquery");
      expect(queueQuery![0]).toContain("ILIKE");
    });

    it("falls back to ILIKE-only filter when tsquery syntax is invalid", async () => {
      const { getPool } = await import("../db.js");
      const invalidTsQueryError = Object.assign(new Error("syntax error in tsquery"), { code: "42601" });
      const mockQuery = vi
        .fn()
        .mockRejectedValueOnce(invalidTsQueryError)
        .mockResolvedValueOnce({ rows: [{ status: "pending", count: 2 }] })
        .mockResolvedValueOnce({ rows: [{ enrichment_status: "pending", count: 2 }] });

      (getPool as any).mockReturnValueOnce({ query: mockQuery });

      const result = await getEnrichmentStats({ filter: "\"unterminated", collection: "docs" });

      expect(result.queue.pending).toBe(2);
      expect(mockQuery.mock.calls.length).toBe(3);
      const fallbackQueueSql = mockQuery.mock.calls[1][0] as string;
      expect(fallbackQueueSql).not.toContain("websearch_to_tsquery");
      expect(fallbackQueueSql).toContain("ILIKE");
    });
  });

  describe("enqueueEnrichment", () => {
    it("enqueues chunks for enrichment", async () => {
      const clientQuery = vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              chunk_id: "test-id:0",
              document_id: "doc-1",
              base_id: "test-id",
              chunk_index: 0,
              text: "test",
              source: "test.txt",
              doc_type: "text",
              tier1_meta: {},
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ document_id: "doc-1", total_chunks: 1 }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const { getPool } = await import("../db.js");
      (getPool as any).mockReturnValueOnce({
        query: vi.fn(async () => ({ rows: [] })),
        connect: vi.fn(async () => ({
          query: clientQuery,
          release: vi.fn(),
        })),
      });

      const result = await enqueueEnrichment({ collection: "test" });

      expect(result.ok).toBe(true);
      expect(result.enqueued).toBeGreaterThanOrEqual(0);
    });

    it("excludes already-enriched chunks when force is false", async () => {
      const clientQuery = vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              chunk_id: "test-id:0",
              document_id: "doc-1",
              base_id: "test-id",
              chunk_index: 0,
              text: "test",
              source: "test.txt",
              doc_type: "text",
              tier1_meta: {},
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ document_id: "doc-1", total_chunks: 1 }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const { getPool } = await import("../db.js");
      (getPool as any).mockReturnValueOnce({
        query: vi.fn(async () => ({ rows: [] })),
        connect: vi.fn(async () => ({
          query: clientQuery,
          release: vi.fn(),
        })),
      });

      const result = await enqueueEnrichment({ collection: "test", force: false });
      expect(result.ok).toBe(true);
      expect(result.enqueued).toBe(1);

      const [sql] = clientQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("c.enrichment_status != 'enriched'");
    });

    it("applies full-text filter to chunk selection", async () => {
      const clientQuery = vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              chunk_id: "test-id:0",
              document_id: "doc-1",
              base_id: "test-id",
              chunk_index: 0,
              text: "test content with filter text",
              source: "test.txt",
              doc_type: "text",
              tier1_meta: {},
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ document_id: "doc-1", total_chunks: 1 }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const { getPool } = await import("../db.js");
      (getPool as any).mockReturnValueOnce({
        query: vi.fn(async () => ({ rows: [] })),
        connect: vi.fn(async () => ({
          query: clientQuery,
          release: vi.fn(),
        })),
      });

      const result = await enqueueEnrichment({
        collection: "test",
        filter: "filter text",
      });

      expect(result.ok).toBe(true);
      expect(result.enqueued).toBe(1);

      const [sql] = clientQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("websearch_to_tsquery");
      expect(sql).toContain("ILIKE");
    });

    it("falls back to ILIKE-only enqueue when tsquery syntax is invalid", async () => {
      const invalidTsQueryError = Object.assign(new Error("syntax error in tsquery"), { code: "42601" });
      const clientQuery = vi
        .fn()
        .mockRejectedValueOnce(invalidTsQueryError)
        .mockResolvedValueOnce({
          rows: [
            {
              chunk_id: "test-id:0",
              document_id: "doc-1",
              base_id: "test-id",
              chunk_index: 0,
              text: "test content",
              source: "test.txt",
              doc_type: "text",
              tier1_meta: {},
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ document_id: "doc-1", total_chunks: 1 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const { getPool } = await import("../db.js");
      (getPool as any).mockReturnValueOnce({
        query: vi.fn(async () => ({ rows: [] })),
        connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() })),
      });

      const result = await enqueueEnrichment({ collection: "docs", filter: "\"unterminated" });

      expect(result.ok).toBe(true);
      const fallbackSql = clientQuery.mock.calls[1][0] as string;
      expect(fallbackSql).not.toContain("websearch_to_tsquery");
      expect(fallbackSql).toContain("ILIKE");
    });
  });

  describe("clearEnrichmentQueue", () => {
    it("clears pending, processing, and dead tasks", async () => {
      const { getPool } = await import("../db.js");
      (getPool as any).mockReturnValueOnce({
        query: vi.fn(async () => ({ rowCount: 5 })),
      });

      const result = await clearEnrichmentQueue({ collection: "test" });

      expect(result.ok).toBe(true);
      expect(result.cleared).toBe(5);
    });

    it("applies filter when clearing queue", async () => {
      const { getPool } = await import("../db.js");
      const mockQuery = vi.fn(async () => ({ rowCount: 3 }));
      (getPool as any).mockReturnValueOnce({
        query: mockQuery,
      });

      const result = await clearEnrichmentQueue({
        collection: "test",
        filter: "specific filter",
      });

      expect(result.ok).toBe(true);
      expect(result.cleared).toBe(3);

      const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("DELETE FROM task_queue");
      expect(sql).toContain("websearch_to_tsquery");
      expect(sql).toContain("ILIKE");
      expect(sql).toContain("IN ('pending', 'processing', 'dead')");
    });

    it("returns 0 when no tasks to clear", async () => {
      const { getPool } = await import("../db.js");
      (getPool as any).mockReturnValueOnce({
        query: vi.fn(async () => ({ rowCount: 0 })),
      });

      const result = await clearEnrichmentQueue({ collection: "test" });

      expect(result.ok).toBe(true);
      expect(result.cleared).toBe(0);
    });

    it("falls back to ILIKE-only clear when tsquery syntax is invalid", async () => {
      const { getPool } = await import("../db.js");
      const invalidTsQueryError = Object.assign(new Error("syntax error in tsquery"), { code: "42601" });
      const mockQuery = vi
        .fn()
        .mockRejectedValueOnce(invalidTsQueryError)
        .mockResolvedValueOnce({ rowCount: 1 });

      (getPool as any).mockReturnValueOnce({
        query: mockQuery,
      });

      const result = await clearEnrichmentQueue({ collection: "docs", filter: "\"unterminated" });

      expect(result.ok).toBe(true);
      expect(result.cleared).toBe(1);
      const fallbackSql = mockQuery.mock.calls[1][0] as string;
      expect(fallbackSql).not.toContain("websearch_to_tsquery");
      expect(fallbackSql).toContain("ILIKE");
    });
  });
});
