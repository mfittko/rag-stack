import { describe, it, expect } from "vitest";
import { translateFilter, formatVector, deriveIdentityKey } from "./pg-helpers.js";

describe("pg-helpers", () => {
  describe("formatVector", () => {
    it("formats number array as pgvector string", () => {
      const vector = [0.1, 0.2, 0.3];
      const result = formatVector(vector);
      expect(result).toBe("[0.1,0.2,0.3]");
    });

    it("handles empty array", () => {
      const result = formatVector([]);
      expect(result).toBe("[]");
    });

    it("handles large vectors", () => {
      const vector = Array(768).fill(0.1);
      const result = formatVector(vector);
      expect(result).toContain("[0.1,0.1,");
      expect(result.endsWith(",0.1]")).toBe(true);
    });
  });

  describe("deriveIdentityKey", () => {
    it("derives stable key from URL", () => {
      const source = "https://example.com/page";
      const key = deriveIdentityKey(source);
      expect(key).toBeDefined();
      expect(key.length).toBeGreaterThan(0);
    });

    it("returns same key for same input", () => {
      const source = "https://example.com/page";
      const key1 = deriveIdentityKey(source);
      const key2 = deriveIdentityKey(source);
      expect(key1).toBe(key2);
    });

    it("returns different keys for different inputs", () => {
      const key1 = deriveIdentityKey("https://example.com/page1");
      const key2 = deriveIdentityKey("https://example.com/page2");
      expect(key1).not.toBe(key2);
    });

    it("handles non-URL sources", () => {
      const source = "document.txt";
      const key = deriveIdentityKey(source);
      expect(key).toBeDefined();
    });
  });

  describe("translateFilter", () => {
    it("returns empty SQL for undefined filter", () => {
      const result = translateFilter(undefined);
      expect(result.sql).toBe("");
      expect(result.params).toEqual([]);
    });

    it("translates simple equality filter", () => {
      const filter = { docType: "code" };
      const result = translateFilter(filter, 3);
      expect(result.sql).toBe(" AND c.doc_type = $4");
      expect(result.params).toEqual(["code"]);
    });

    it("translates must conditions", () => {
      const filter = {
        must: [
          { key: "docType", match: { value: "code" } },
          { key: "lang", match: { value: "typescript" } },
        ],
      };
      const result = translateFilter(filter, 3);
      expect(result.sql).toContain("c.doc_type = $4");
      expect(result.sql).toContain("c.lang = $5");
      expect(result.params).toEqual(["code", "typescript"]);
    });

    it("translates must_not conditions", () => {
      const filter = {
        must_not: [{ key: "docType", match: { value: "image" } }],
      };
      const result = translateFilter(filter, 3);
      expect(result.sql).toBe(" AND c.doc_type != $4");
      expect(result.params).toEqual(["image"]);
    });

    it("uses custom table alias", () => {
      const filter = { docType: "code" };
      const result = translateFilter(filter, 0, "chunks");
      expect(result.sql).toBe(" AND chunks.doc_type = $1");
    });

    it("handles camelCase to snake_case conversion", () => {
      const filter = { repoId: "123" };
      const result = translateFilter(filter);
      expect(result.sql).toContain("repo_id");
    });

    it("handles first character uppercase correctly", () => {
      const filter = { ChunkIndex: 0 };
      const result = translateFilter(filter);
      expect(result.sql).toBe(" AND c.chunk_index = $1");
      expect(result.sql).not.toContain("_chunk_index");
    });

    it("rejects unsupported filter columns", () => {
      expect(() => translateFilter({ source: "doc" })).toThrow("Unsupported filter key");
    });

    it("rejects malicious filter keys", () => {
      expect(() => translateFilter({ "id; DROP TABLE chunks--": "x" })).toThrow("Unsupported filter key");
    });
  });
});
