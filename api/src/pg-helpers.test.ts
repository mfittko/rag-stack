import { describe, it, expect } from "vitest";
import { translateFilter, formatVector, deriveIdentityKey, FilterValidationError } from "./pg-helpers.js";

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

    it("translates path filter as prefix match", () => {
      const filter = { path: "src/" };
      const result = translateFilter(filter, 3);
      expect(result.sql).toBe(" AND c.path LIKE $4 || '%'" );
      expect(result.params).toEqual(["src/"]);
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

    it("translates legacy path text match as prefix match", () => {
      const filter = {
        must: [{ key: "path", match: { text: "src/" } }],
      };
      const result = translateFilter(filter, 3);
      expect(result.sql).toBe(" AND c.path LIKE $4 || '%'" );
      expect(result.params).toEqual(["src/"]);
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

  describe("translateFilter — new DSL", () => {
    it("DSL detected when conditions key present", () => {
      const filter = { conditions: [{ field: "docType", op: "eq", value: "code" }] };
      const result = translateFilter(filter);
      expect(result.sql).toBe(" AND c.doc_type = $1");
      expect(result.params).toEqual(["code"]);
    });

    it("eq on path uses LIKE prefix match", () => {
      const filter = { conditions: [{ field: "path", op: "eq", value: "src/" }] };
      const result = translateFilter(filter);
      expect(result.sql).toBe(" AND c.path LIKE $1 || '%'");
      expect(result.params).toEqual(["src/"]);
    });

    it("ne operator", () => {
      const filter = { conditions: [{ field: "docType", op: "ne", value: "image" }] };
      const result = translateFilter(filter);
      expect(result.sql).toBe(" AND c.doc_type != $1");
      expect(result.params).toEqual(["image"]);
    });

    it("ne on path uses NOT LIKE prefix match", () => {
      const filter = { conditions: [{ field: "path", op: "ne", value: "src/" }] };
      const result = translateFilter(filter);
      expect(result.sql).toBe(" AND c.path NOT LIKE $1 || '%'");
      expect(result.params).toEqual(["src/"]);
    });

    it("gt operator", () => {
      const filter = { conditions: [{ field: "chunkIndex", op: "gt", value: 0 }] };
      const result = translateFilter(filter);
      expect(result.sql).toBe(" AND c.chunk_index > $1");
      expect(result.params).toEqual([0]);
    });

    it("gte operator", () => {
      const filter = { conditions: [{ field: "createdAt", op: "gte", value: "2025-01-01T00:00:00Z" }] };
      const result = translateFilter(filter);
      expect(result.sql).toBe(" AND c.created_at >= $1");
      expect(result.params).toEqual(["2025-01-01T00:00:00Z"]);
    });

    it("lt operator", () => {
      const filter = { conditions: [{ field: "chunkIndex", op: "lt", value: 10 }] };
      const result = translateFilter(filter);
      expect(result.sql).toBe(" AND c.chunk_index < $1");
      expect(result.params).toEqual([10]);
    });

    it("lte operator", () => {
      const filter = { conditions: [{ field: "chunkIndex", op: "lte", value: 10 }] };
      const result = translateFilter(filter);
      expect(result.sql).toBe(" AND c.chunk_index <= $1");
      expect(result.params).toEqual([10]);
    });

    it("in operator", () => {
      const filter = { conditions: [{ field: "lang", op: "in", values: ["ts", "js"] }] };
      const result = translateFilter(filter);
      expect(result.sql).toBe(" AND c.lang IN ($1, $2)");
      expect(result.params).toEqual(["ts", "js"]);
    });

    it("notIn operator", () => {
      const filter = { conditions: [{ field: "lang", op: "notIn", values: ["py"] }] };
      const result = translateFilter(filter);
      expect(result.sql).toBe(" AND c.lang NOT IN ($1)");
      expect(result.params).toEqual(["py"]);
    });

    it("between operator", () => {
      const filter = {
        conditions: [{ field: "createdAt", op: "between", range: { low: "2025-01-01", high: "2025-12-31" } }],
      };
      const result = translateFilter(filter);
      expect(result.sql).toBe(" AND c.created_at >= $1 AND c.created_at <= $2");
      expect(result.params).toEqual(["2025-01-01", "2025-12-31"]);
    });

    it("notBetween operator", () => {
      const filter = {
        conditions: [{ field: "chunkIndex", op: "notBetween", range: { low: 5, high: 10 } }],
      };
      const result = translateFilter(filter);
      expect(result.sql).toBe(" AND (c.chunk_index < $1 OR c.chunk_index > $2)");
      expect(result.params).toEqual([5, 10]);
    });

    it("isNull operator — no params", () => {
      const filter = { conditions: [{ field: "enrichmentStatus", op: "isNull" }] };
      const result = translateFilter(filter);
      expect(result.sql).toBe(" AND c.enrichment_status IS NULL");
      expect(result.params).toEqual([]);
    });

    it("isNotNull operator — no params", () => {
      const filter = { conditions: [{ field: "enrichmentStatus", op: "isNotNull" }] };
      const result = translateFilter(filter);
      expect(result.sql).toBe(" AND c.enrichment_status IS NOT NULL");
      expect(result.params).toEqual([]);
    });

    it("document-level field with alias d", () => {
      const filter = { conditions: [{ field: "ingestedAt", op: "gte", value: "2025-01-01T00:00:00Z", alias: "d" }] };
      const result = translateFilter(filter);
      expect(result.sql).toBe(" AND d.ingested_at >= $1");
      expect(result.params).toEqual(["2025-01-01T00:00:00Z"]);
    });

    it("document-level field without explicit alias (defaults to d)", () => {
      const filter = { conditions: [{ field: "mimeType", op: "eq", value: "application/pdf" }] };
      const result = translateFilter(filter);
      expect(result.sql).toBe(" AND d.mime_type = $1");
      expect(result.params).toEqual(["application/pdf"]);
    });

    it("combine: 'or' joins two conditions with OR in parentheses", () => {
      const filter = {
        conditions: [
          { field: "docType", op: "eq", value: "code" },
          { field: "lang", op: "eq", value: "ts" },
        ],
        combine: "or",
      };
      const result = translateFilter(filter);
      expect(result.sql).toBe(" AND (c.doc_type = $1 OR c.lang = $2)");
      expect(result.params).toEqual(["code", "ts"]);
    });

    it("combine: 'and' (default) joins two conditions with AND in parentheses", () => {
      const filter = {
        conditions: [
          { field: "docType", op: "eq", value: "code" },
          { field: "lang", op: "eq", value: "ts" },
        ],
      };
      const result = translateFilter(filter);
      expect(result.sql).toBe(" AND (c.doc_type = $1 AND c.lang = $2)");
      expect(result.params).toEqual(["code", "ts"]);
    });

    it("single condition — no grouping parentheses", () => {
      const filter = { conditions: [{ field: "docType", op: "eq", value: "code" }] };
      const result = translateFilter(filter);
      expect(result.sql).not.toContain("(");
    });

    it("param offset is respected", () => {
      const filter = { conditions: [{ field: "docType", op: "eq", value: "code" }] };
      const result = translateFilter(filter, 4);
      expect(result.sql).toBe(" AND c.doc_type = $5");
      expect(result.params).toEqual(["code"]);
    });

    it("param offset with in operator", () => {
      const filter = { conditions: [{ field: "lang", op: "in", values: ["ts", "js"] }] };
      const result = translateFilter(filter, 4);
      expect(result.sql).toBe(" AND c.lang IN ($5, $6)");
      expect(result.params).toEqual(["ts", "js"]);
    });

    it("unknown field → FilterValidationError", () => {
      const filter = { conditions: [{ field: "bogus", op: "eq", value: "x" }] };
      expect(() => translateFilter(filter)).toThrow(FilterValidationError);
      expect(() => translateFilter(filter)).toThrow("Unknown filter field: bogus");
    });

    it("wrong alias for doc-level field → FilterValidationError", () => {
      const filter = { conditions: [{ field: "ingestedAt", op: "gte", value: "2025-01-01", alias: "c" }] };
      expect(() => translateFilter(filter)).toThrow(FilterValidationError);
    });

    it("empty in array → FilterValidationError", () => {
      const filter = { conditions: [{ field: "lang", op: "in", values: [] }] };
      expect(() => translateFilter(filter)).toThrow(FilterValidationError);
      expect(() => translateFilter(filter)).toThrow("non-empty values array");
    });

    it("empty notIn array → FilterValidationError", () => {
      const filter = { conditions: [{ field: "lang", op: "notIn", values: [] }] };
      expect(() => translateFilter(filter)).toThrow(FilterValidationError);
    });

    it("disallowed operator for field → FilterValidationError", () => {
      // docType is text, so gt is not allowed
      const filter = { conditions: [{ field: "docType", op: "gt", value: "code" }] };
      expect(() => translateFilter(filter)).toThrow(FilterValidationError);
      expect(() => translateFilter(filter)).toThrow('Operator "gt" not allowed for field "docType"');
    });

    it("between without range → FilterValidationError", () => {
      const filter = { conditions: [{ field: "createdAt", op: "between" }] };
      expect(() => translateFilter(filter)).toThrow(FilterValidationError);
    });

    it("empty conditions array returns empty SQL", () => {
      const filter = { conditions: [] };
      const result = translateFilter(filter);
      expect(result.sql).toBe("");
      expect(result.params).toEqual([]);
    });

    it("FilterValidationError has statusCode 400", () => {
      const err = new FilterValidationError("test");
      expect(err.statusCode).toBe(400);
    });

    it("invalid combine value → FilterValidationError", () => {
      const filter = { conditions: [{ field: "docType", op: "eq", value: "code" }], combine: "xor" as "and" };
      expect(() => translateFilter(filter)).toThrow(FilterValidationError);
      expect(() => translateFilter(filter)).toThrow('Invalid combine operator "xor"');
    });

    it("mixed format (conditions + legacy key) → FilterValidationError", () => {
      const filter = { conditions: [{ field: "docType", op: "eq", value: "code" }], docType: "code" } as unknown as Record<string, unknown>;
      expect(() => translateFilter(filter)).toThrow(FilterValidationError);
      expect(() => translateFilter(filter)).toThrow("Mixed filter format");
    });
  });
});
