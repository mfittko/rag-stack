import { describe, it, expect, vi, beforeEach } from "vitest";
import { claimTask, submitTaskResult, failTask, recoverStaleTasks } from "./internal.js";

// Mock the db module
vi.mock("../db.js", () => ({
  getPool: vi.fn(() => ({
    connect: vi.fn(async () => ({
      query: vi.fn(async (sql: string) => {
        if (sql.includes("UPDATE task_queue")) {
          return {
            rows: [
              {
                id: "task-123",
                payload: {
                  chunkId: "base-id:0",
                  collection: "docs",
                  baseId: "base-id",
                },
                attempt: 1,
              },
            ],
          };
        }
        if (sql.includes("FROM chunks c")) {
          return {
            rows: [
              { chunk_index: 0, text: "chunk 0 text" },
              { chunk_index: 1, text: "chunk 1 text" },
            ],
          };
        }
        if (sql.includes("FROM documents WHERE base_id")) {
          return { rows: [{ id: "doc-123" }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    })),
    query: vi.fn(async () => ({ rows: [] })),
  })),
}));

describe("internal service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("claimTask", () => {
    it("claims a task and returns payload with chunk texts", async () => {
      const result = await claimTask({ workerId: "worker-1", leaseDuration: 300 });

      expect(result.task).toBeDefined();
      expect(result.task?.id).toBe("task-123");
      expect(result.chunks).toBeDefined();
      expect(result.chunks?.length).toBe(2);
    });

    it("returns empty object when no tasks available", async () => {
      const { getPool } = await import("../db.js");
      (getPool as any).mockReturnValueOnce({
        connect: vi.fn(async () => ({
          query: vi.fn(async () => ({ rows: [] })),
          release: vi.fn(),
        })),
      });

      const result = await claimTask({ workerId: "worker-1" });
      expect(result.task).toBeUndefined();
      expect(result.chunks).toBeUndefined();
    });

    it("uses default worker ID and lease duration when not provided", async () => {
      const result = await claimTask({});
      // Should not throw and should work with defaults
      expect(result).toBeDefined();
    });
  });

  describe("submitTaskResult", () => {
    it("submits enrichment results successfully", async () => {
      await expect(
        submitTaskResult("task-123", {
          chunkId: "base-id:0",
          collection: "docs",
          tier2: { entities: [] },
          tier3: {},
          entities: [
            { name: "Entity1", type: "person" },
          ],
          relationships: [],
        })
      ).resolves.not.toThrow();
    });

    it("validates chunkId format", async () => {
      await expect(
        submitTaskResult("task-123", {
          chunkId: "invalid-format",
          collection: "docs",
        })
      ).rejects.toThrow("Invalid chunkId format");
    });

    it("validates chunk index is a number", async () => {
      await expect(
        submitTaskResult("task-123", {
          chunkId: "base-id:abc",
          collection: "docs",
        })
      ).rejects.toThrow("Invalid chunk index");
    });

    it("validates chunk index is non-negative", async () => {
      await expect(
        submitTaskResult("task-123", {
          chunkId: "base-id:-1",
          collection: "docs",
        })
      ).rejects.toThrow("Invalid chunk index");
    });

    it("accepts chunkId when baseId contains colons", async () => {
      await expect(
        submitTaskResult("task-123", {
          chunkId: "repo:file.py:0",
          collection: "docs",
        })
      ).resolves.not.toThrow();
    });

    it("stores summaries at document level, omits from chunk tier3_meta", async () => {
      const { getPool } = await import("../db.js");
      const mockClientQuery = vi.fn(async (sql: string) => {
        if (sql.includes("FROM documents WHERE base_id")) {
          return { rows: [{ id: "doc-123" }] };
        }
        return { rows: [] };
      });

      (getPool as any).mockReturnValueOnce({
        connect: vi.fn(async () => ({
          query: mockClientQuery,
          release: vi.fn(),
        })),
      });

      await submitTaskResult("task-123", {
        chunkId: "base-id:0",
        collection: "docs",
        tier2: {},
        tier3: {
          summary_short: "Short summary",
          summary_medium: "Medium summary",
          summary_long: "Long summary",
          otherField: "keep this",
        },
      });

      // Find the chunk update query
      const chunkUpdateCall = mockClientQuery.mock.calls.find((call: any) =>
        call[0].includes("UPDATE chunks c")
      );
      expect(chunkUpdateCall).toBeDefined();
      expect(chunkUpdateCall![0]).toContain("- 'summary'");
      expect(chunkUpdateCall![0]).toContain("- 'summary_short'");
      expect(chunkUpdateCall![0]).toContain("- 'summary_medium'");
      expect(chunkUpdateCall![0]).toContain("- 'summary_long'");
      expect(chunkUpdateCall![0]).toContain("- '_error'");

      const chunkTier3Payload = JSON.parse(chunkUpdateCall![1][1]);
      expect(chunkTier3Payload).not.toHaveProperty("summary");
      expect(chunkTier3Payload).not.toHaveProperty("summary_short");
      expect(chunkTier3Payload).not.toHaveProperty("summary_medium");
      expect(chunkTier3Payload).not.toHaveProperty("summary_long");
      expect(chunkTier3Payload.otherField).toBe("keep this");

      // Find the document update query
      const docUpdateCall = mockClientQuery.mock.calls.find((call: any) =>
        call[0].includes("UPDATE documents SET")
      );
      expect(docUpdateCall).toBeDefined();
      expect(docUpdateCall![0]).toContain("summary_short");
      expect(docUpdateCall![0]).toContain("summary_medium");
      expect(docUpdateCall![0]).toContain("summary_long");
    });

    it("uses fallback hierarchy for summary_medium", async () => {
      const { getPool } = await import("../db.js");
      const mockClientQuery = vi.fn(async (sql: string) => {
        if (sql.includes("FROM documents WHERE base_id")) {
          return { rows: [{ id: "doc-123" }] };
        }
        return { rows: [] };
      });

      (getPool as any).mockReturnValueOnce({
        connect: vi.fn(async () => ({
          query: mockClientQuery,
          release: vi.fn(),
        })),
      });

      await submitTaskResult("task-123", {
        chunkId: "base-id:0",
        collection: "docs",
        summary: "Fallback summary from result.summary",
        tier3: {},
      });

      // Find the document update query
      const docUpdateCall = mockClientQuery.mock.calls.find((call: any) =>
        call[0].includes("UPDATE documents SET")
      );
      expect(docUpdateCall).toBeDefined();
      // Verify summary was passed as medium
      expect(docUpdateCall![1][1]).toBe("Fallback summary from result.summary");
    });
  });

  describe("failTask", () => {
    it("marks task as failed", async () => {
      const { getPool } = await import("../db.js");
      (getPool as any).mockReturnValueOnce({
        connect: vi.fn(async () => ({
          query: vi.fn(async (sql: string) => {
            if (sql.includes("SELECT attempt")) {
              return {
                rows: [{
                  attempt: 1,
                  max_attempts: 3,
                  payload: {
                    baseId: "base-id",
                    collection: "docs",
                    chunkIndex: 0,
                  },
                }],
              };
            }
            return { rows: [] };
          }),
          release: vi.fn(),
        })),
      });

      await expect(
        failTask("task-123", { error: "Test error" })
      ).resolves.not.toThrow();
    });

    it("retries with 60-second delay for non-final attempts", async () => {
      const { getPool } = await import("../db.js");
      const mockClientQuery = vi.fn(async (sql: string) => {
        if (sql.includes("SELECT attempt")) {
          return {
            rows: [{
              attempt: 1,
              max_attempts: 3,
              payload: {
                baseId: "base-id",
                collection: "docs",
                chunkIndex: 0,
              },
            }],
          };
        }
        return { rows: [] };
      });

      (getPool as any).mockReturnValueOnce({
        connect: vi.fn(async () => ({
          query: mockClientQuery,
          release: vi.fn(),
        })),
      });

      await failTask("task-123", { error: "Test error" });

      // Find the retry update query
      const retryCall = mockClientQuery.mock.calls.find((call: any) =>
        call[0].includes("status = 'pending'") && call[0].includes("interval '60 seconds'")
      );
      expect(retryCall).toBeDefined();
    });

    it("moves to dead letter on final attempt", async () => {
      const { getPool } = await import("../db.js");
      const mockClientQuery = vi.fn(async (sql: string) => {
        if (sql.includes("SELECT attempt")) {
          return {
            rows: [{
              attempt: 3,
              max_attempts: 3,
              payload: {
                baseId: "base-id",
                collection: "docs",
                chunkIndex: 0,
              },
            }],
          };
        }
        return { rows: [] };
      });

      (getPool as any).mockReturnValueOnce({
        connect: vi.fn(async () => ({
          query: mockClientQuery,
          release: vi.fn(),
        })),
      });

      await failTask("task-123", { error: "Final attempt failed" });

      // Find the dead-letter update query
      const deadLetterCall = mockClientQuery.mock.calls.find((call: any) =>
        call[0].includes("status = 'dead'")
      );
      expect(deadLetterCall).toBeDefined();
      expect(deadLetterCall![0]).toContain("completed_at = now()");
    });

    it("records error metadata in chunk tier3_meta", async () => {
      const { getPool } = await import("../db.js");
      const mockClientQuery = vi.fn(async (sql: string) => {
        if (sql.includes("SELECT attempt")) {
          return {
            rows: [{
              attempt: 2,
              max_attempts: 3,
              payload: {
                baseId: "base-id",
                collection: "docs",
                chunkIndex: 5,
              },
            }],
          };
        }
        return { rows: [] };
      });

      (getPool as any).mockReturnValueOnce({
        connect: vi.fn(async () => ({
          query: mockClientQuery,
          release: vi.fn(),
        })),
      });

      await failTask("task-123", { error: "Test error message" });

      // Find the chunk update query
      const chunkUpdateCall = mockClientQuery.mock.calls.find((call: any) =>
        call[0].includes("UPDATE chunks c SET") && call[0].includes("_error")
      );
      expect(chunkUpdateCall).toBeDefined();
      expect(chunkUpdateCall![0]).toContain("enrichment_status = 'failed'");
      expect(chunkUpdateCall![0]).toContain("jsonb_build_object");
      expect(chunkUpdateCall![0]).toContain("'_error'");
      expect(chunkUpdateCall![0]).toContain("'chunkIndex'");
      expect(chunkUpdateCall![1][2]).toBe(5);
    });

    it("parses chunk index from chunkId format", async () => {
      const { getPool } = await import("../db.js");
      const mockClientQuery = vi.fn(async (sql: string) => {
        if (sql.includes("SELECT attempt")) {
          return {
            rows: [{
              attempt: 1,
              max_attempts: 3,
              payload: {
                baseId: "base-id",
                collection: "docs",
                chunkId: "base-id:7",
              },
            }],
          };
        }
        return { rows: [] };
      });

      (getPool as any).mockReturnValueOnce({
        connect: vi.fn(async () => ({
          query: mockClientQuery,
          release: vi.fn(),
        })),
      });

      await failTask("task-123", { error: "Test error" });

      // Find the chunk update query and verify chunk_index parameter
      const chunkUpdateCall = mockClientQuery.mock.calls.find((call: any) =>
        call[0].includes("UPDATE chunks c SET") && call[0].includes("_error")
      );
      expect(chunkUpdateCall).toBeDefined();
      // The third parameter should be the parsed chunk index
      expect(chunkUpdateCall![1][2]).toBe(7);
    });
  });

  describe("recoverStaleTasks", () => {
    it("recovers stale tasks", async () => {
      const { getPool } = await import("../db.js");
      (getPool as any).mockReturnValueOnce({
        query: vi.fn(async () => ({ rowCount: 5 })),
      });

      const result = await recoverStaleTasks();
      expect(result.recovered).toBe(5);
    });

    it("returns 0 when no stale tasks", async () => {
      const { getPool } = await import("../db.js");
      (getPool as any).mockReturnValueOnce({
        query: vi.fn(async () => ({ rowCount: 0 })),
      });

      const result = await recoverStaleTasks();
      expect(result.recovered).toBe(0);
    });
  });
});
