// Postgres helper functions for common operations

/**
 * Error thrown when a filter DSL condition fails validation.
 * Sets statusCode=400 so Fastify's error handler returns HTTP 400.
 */
export class FilterValidationError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "FilterValidationError";
  }
}

// ---------------------------------------------------------------------------
// New filter DSL types
// ---------------------------------------------------------------------------

export interface FilterCondition {
  field: string;
  op: string;
  value?: unknown;
  values?: unknown[];
  range?: { low: unknown; high: unknown };
  alias?: string;
}

export interface FilterDSL {
  conditions: FilterCondition[];
  combine?: "and" | "or";
}

// ---------------------------------------------------------------------------
// FIELD_DEFS — two-tier allowlist (chunk "c." + document "d.")
// ---------------------------------------------------------------------------

interface FieldDef {
  tableAlias: "c" | "d";
  column: string;
  allowedOps: ReadonlySet<string>;
}

const TEXT_OPS: ReadonlySet<string> = new Set(["eq", "ne", "in", "notIn", "isNull", "isNotNull"]);
const TEMPORAL_OPS: ReadonlySet<string> = new Set([
  "eq", "ne", "gt", "gte", "lt", "lte",
  "between", "notBetween", "in", "notIn", "isNull", "isNotNull",
]);

const FIELD_DEFS = new Map<string, FieldDef>([
  ["chunkIndex",       { tableAlias: "c", column: "chunk_index",      allowedOps: TEMPORAL_OPS }],
  ["docType",          { tableAlias: "c", column: "doc_type",          allowedOps: TEXT_OPS }],
  ["repoId",           { tableAlias: "c", column: "repo_id",           allowedOps: TEXT_OPS }],
  ["repoUrl",          { tableAlias: "c", column: "repo_url",          allowedOps: TEXT_OPS }],
  ["path",             { tableAlias: "c", column: "path",              allowedOps: TEXT_OPS }],
  ["lang",             { tableAlias: "c", column: "lang",              allowedOps: TEXT_OPS }],
  ["itemUrl",          { tableAlias: "c", column: "item_url",          allowedOps: TEXT_OPS }],
  ["enrichmentStatus", { tableAlias: "c", column: "enrichment_status", allowedOps: TEXT_OPS }],
  ["createdAt",        { tableAlias: "c", column: "created_at",        allowedOps: TEMPORAL_OPS }],
  ["ingestedAt",       { tableAlias: "d", column: "ingested_at",       allowedOps: TEMPORAL_OPS }],
  ["updatedAt",        { tableAlias: "d", column: "updated_at",        allowedOps: TEMPORAL_OPS }],
  ["lastSeen",         { tableAlias: "d", column: "last_seen",         allowedOps: TEMPORAL_OPS }],
  ["mimeType",         { tableAlias: "d", column: "mime_type",         allowedOps: TEXT_OPS }],
]);

// ---------------------------------------------------------------------------
// New DSL translation
// ---------------------------------------------------------------------------

function translateCondition(
  cond: FilterCondition,
  paramIndex: number,
): { sql: string; params: unknown[]; nextIndex: number } {
  const fieldDef = FIELD_DEFS.get(cond.field);
  if (!fieldDef) {
    throw new FilterValidationError(`Unknown filter field: ${cond.field}`);
  }

  const expectedAlias = fieldDef.tableAlias;
  if (cond.alias !== undefined && cond.alias !== expectedAlias) {
    throw new FilterValidationError(
      `Field "${cond.field}" requires alias "${expectedAlias}", got "${cond.alias}"`
    );
  }

  if (!fieldDef.allowedOps.has(cond.op)) {
    throw new FilterValidationError(
      `Operator "${cond.op}" not allowed for field "${cond.field}"`
    );
  }

  const col = `${expectedAlias}.${fieldDef.column}`;
  const isPath = fieldDef.column === "path";

  switch (cond.op) {
    case "eq":
      if (isPath) {
        return { sql: `${col} LIKE $${paramIndex} || '%'`, params: [cond.value], nextIndex: paramIndex + 1 };
      }
      return { sql: `${col} = $${paramIndex}`, params: [cond.value], nextIndex: paramIndex + 1 };

    case "ne":
      if (isPath) {
        return { sql: `${col} NOT LIKE $${paramIndex} || '%'`, params: [cond.value], nextIndex: paramIndex + 1 };
      }
      return { sql: `${col} != $${paramIndex}`, params: [cond.value], nextIndex: paramIndex + 1 };

    case "gt":
      return { sql: `${col} > $${paramIndex}`, params: [cond.value], nextIndex: paramIndex + 1 };

    case "gte":
      return { sql: `${col} >= $${paramIndex}`, params: [cond.value], nextIndex: paramIndex + 1 };

    case "lt":
      return { sql: `${col} < $${paramIndex}`, params: [cond.value], nextIndex: paramIndex + 1 };

    case "lte":
      return { sql: `${col} <= $${paramIndex}`, params: [cond.value], nextIndex: paramIndex + 1 };

    case "in": {
      if (!Array.isArray(cond.values) || cond.values.length === 0) {
        throw new FilterValidationError(`Operator "in" requires non-empty values array for field "${cond.field}"`);
      }
      const placeholders = cond.values.map((_, i) => `$${paramIndex + i}`).join(", ");
      return { sql: `${col} IN (${placeholders})`, params: cond.values, nextIndex: paramIndex + cond.values.length };
    }

    case "notIn": {
      if (!Array.isArray(cond.values) || cond.values.length === 0) {
        throw new FilterValidationError(`Operator "notIn" requires non-empty values array for field "${cond.field}"`);
      }
      const placeholders = cond.values.map((_, i) => `$${paramIndex + i}`).join(", ");
      return { sql: `${col} NOT IN (${placeholders})`, params: cond.values, nextIndex: paramIndex + cond.values.length };
    }

    case "between": {
      if (!cond.range || cond.range.low === undefined || cond.range.high === undefined) {
        throw new FilterValidationError(`Operator "between" requires range.low and range.high for field "${cond.field}"`);
      }
      return {
        sql: `${col} >= $${paramIndex} AND ${col} <= $${paramIndex + 1}`,
        params: [cond.range.low, cond.range.high],
        nextIndex: paramIndex + 2,
      };
    }

    case "notBetween": {
      if (!cond.range || cond.range.low === undefined || cond.range.high === undefined) {
        throw new FilterValidationError(`Operator "notBetween" requires range.low and range.high for field "${cond.field}"`);
      }
      return {
        sql: `(${col} < $${paramIndex} OR ${col} > $${paramIndex + 1})`,
        params: [cond.range.low, cond.range.high],
        nextIndex: paramIndex + 2,
      };
    }

    case "isNull":
      return { sql: `${col} IS NULL`, params: [], nextIndex: paramIndex };

    case "isNotNull":
      return { sql: `${col} IS NOT NULL`, params: [], nextIndex: paramIndex };

    default:
      throw new FilterValidationError(`Unknown operator: ${cond.op}`);
  }
}

function translateNewDSL(
  dsl: FilterDSL,
  paramIndexOffset: number,
): { sql: string; params: unknown[] } {
  const rawCombine = dsl.combine ?? "and";
  if (rawCombine !== "and" && rawCombine !== "or") {
    throw new FilterValidationError(
      `Invalid combine operator "${rawCombine}". Expected "and" or "or".`,
    );
  }
  const combine = rawCombine.toUpperCase();
  const sqlFragments: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1 + paramIndexOffset;

  for (const cond of dsl.conditions) {
    const result = translateCondition(cond, paramIndex);
    sqlFragments.push(result.sql);
    params.push(...result.params);
    paramIndex = result.nextIndex;
  }

  if (sqlFragments.length === 0) {
    return { sql: "", params: [] };
  }

  const joined =
    sqlFragments.length === 1
      ? sqlFragments[0]
      : `(${sqlFragments.join(` ${combine} `)})`;

  return { sql: ` AND ${joined}`, params };
}

// ---------------------------------------------------------------------------
// Legacy filter translation (verbatim extracted from original translateFilter)
// ---------------------------------------------------------------------------

function translateLegacyFilter(
  filter: Record<string, unknown>,
  paramIndexOffset: number,
  tableAlias: string,
): { sql: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1 + paramIndexOffset;

  for (const [key, value] of Object.entries(filter)) {
    if (key === "must") {
      const mustConds = value as Array<{ key: string; match: { value?: unknown; text?: unknown } }>;
      for (const cond of mustConds) {
        const column = toAllowedColumn(cond.key);
        const filterValue = cond.match.value ?? cond.match.text;
        if (column === "path") {
          conditions.push(`${tableAlias}.${column} LIKE $${paramIndex} || '%'`);
        } else {
          conditions.push(`${tableAlias}.${column} = $${paramIndex}`);
        }
        params.push(filterValue);
        paramIndex++;
      }
    } else if (key === "must_not") {
      const mustNotConds = value as Array<{ key: string; match: { value?: unknown; text?: unknown } }>;
      for (const cond of mustNotConds) {
        const column = toAllowedColumn(cond.key);
        const filterValue = cond.match.value ?? cond.match.text;
        if (column === "path") {
          conditions.push(`${tableAlias}.${column} NOT LIKE $${paramIndex} || '%'`);
        } else {
          conditions.push(`${tableAlias}.${column} != $${paramIndex}`);
        }
        params.push(filterValue);
        paramIndex++;
      }
    } else {
      const column = toAllowedColumn(key);
      if (column === "path") {
        conditions.push(`${tableAlias}.${column} LIKE $${paramIndex} || '%'`);
      } else {
        conditions.push(`${tableAlias}.${column} = $${paramIndex}`);
      }
      params.push(value);
      paramIndex++;
    }
  }

  const sql = conditions.length > 0 ? ` AND ${conditions.join(" AND ")}` : "";
  return { sql, params };
}

// ---------------------------------------------------------------------------
// Public translateFilter — dispatches between DSL and legacy formats
// ---------------------------------------------------------------------------

/**
 * Translates a filter to a Postgres WHERE clause fragment.
 *
 * Dispatch rule:
 *   - `conditions` key present → new DSL (translateNewDSL)
 *   - otherwise               → legacy Qdrant-style filter (translateLegacyFilter)
 *
 * @param filter - The filter object (legacy or new DSL)
 * @param paramIndexOffset - Starting parameter index offset (default: 0)
 * @param tableAlias - Table alias for legacy path (default: "c"); ignored in new DSL
 */
export function translateFilter(
  filter?: Record<string, unknown> | FilterDSL,
  paramIndexOffset = 0,
  tableAlias = "c"
): { sql: string; params: unknown[] } {
  if (!filter) {
    return { sql: "", params: [] };
  }

  if ("conditions" in filter) {
    const dslKeys = new Set(["conditions", "combine"]);
    const extraKeys = Object.keys(filter).filter((k) => !dslKeys.has(k));
    if (extraKeys.length > 0) {
      throw new FilterValidationError(
        `Mixed filter format detected: DSL key "conditions" cannot be combined with legacy keys: ${extraKeys.join(", ")}.`,
      );
    }
    return translateNewDSL(filter as FilterDSL, paramIndexOffset);
  }

  return translateLegacyFilter(filter as Record<string, unknown>, paramIndexOffset, tableAlias);
}

/**
 * Converts camelCase to snake_case for database columns
 * Handles the first character specially to avoid leading underscore
 */
function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, (match, p1, offset) => {
      return offset === 0 ? p1.toLowerCase() : `_${p1.toLowerCase()}`;
    });
}

const ALLOWED_FILTER_COLUMNS = new Set([
  "chunk_index",
  "doc_type",
  "repo_id",
  "repo_url",
  "path",
  "lang",
  "item_url",
  "enrichment_status",
]);

function toAllowedColumn(key: string): string {
  const column = toSnakeCase(key);
  if (!/^[a-z_][a-z0-9_]*$/.test(column) || !ALLOWED_FILTER_COLUMNS.has(column)) {
    throw new Error(`Unsupported filter key: ${key}`);
  }
  return column;
}

/**
 * Formats a vector array as Postgres vector literal
 */
export function formatVector(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

/**
 * Derives identity_key from source URL/path for idempotent re-ingests
 */
export function deriveIdentityKey(source: string): string {
  try {
    const url = new URL(source);
    // Use origin + pathname as identity key (strips query params, hash)
    return `${url.origin}${url.pathname}`;
  } catch {
    // Not a URL, use as-is
    return source;
  }
}
