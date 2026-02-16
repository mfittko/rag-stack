// Postgres helper functions for common operations

/**
 * Translates a Qdrant-style filter to Postgres WHERE clause
 * Supports basic filters for now - can be extended as needed
 * @param filter - The filter object
 * @param paramIndexOffset - Starting parameter index (default: 0)
 */
export function translateFilter(
  filter?: Record<string, unknown>,
  paramIndexOffset = 0
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
      const mustConds = value as Array<{ key: string; match: { value: unknown } }>;
      for (const cond of mustConds) {
        const column = toSnakeCase(cond.key);
        conditions.push(`${column} = $${paramIndex}`);
        params.push(cond.match.value);
        paramIndex++;
      }
    } else if (key === "must_not") {
      // Array of conditions that must not match
      const mustNotConds = value as Array<{ key: string; match: { value: unknown } }>;
      for (const cond of mustNotConds) {
        const column = toSnakeCase(cond.key);
        conditions.push(`${column} != $${paramIndex}`);
        params.push(cond.match.value);
        paramIndex++;
      }
    } else {
      // Simple key-value filter
      const column = toSnakeCase(key);
      conditions.push(`${column} = $${paramIndex}`);
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
