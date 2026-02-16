// Postgres helper functions for common operations

/**
 * Translates a Qdrant-style filter to Postgres WHERE clause
 * Supports basic filters for now - can be extended as needed
 * @param filter - The filter object
 * @param paramIndexOffset - Starting parameter index (default: 0)
 * @param tableAlias - Table alias prefix for columns (default: "c")
 */
export function translateFilter(
  filter?: Record<string, unknown>,
  paramIndexOffset = 0,
  tableAlias = "c"
): { sql: string; params: unknown[] } {
  if (!filter) {
    return { sql: "", params: [] };
  }

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1 + paramIndexOffset;

  // Handle simple equality filters
  for (const [key, value] of Object.entries(filter)) {
    if (key === "must") {
      // Array of conditions that must match
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
      // Array of conditions that must not match
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
      // Simple key-value filter
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
