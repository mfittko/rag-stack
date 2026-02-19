# API Reference

HTTP API for the raged service.

**Base URL:** `http://localhost:8080` (local) or your Ingress hostname (remote)

## Authentication

When `RAGED_API_TOKEN` is set, all endpoints except `GET /healthz` require:

```
Authorization: Bearer <token>
```

## Endpoints

### GET /healthz

Liveness endpoint. Always unauthenticated.

```json
{ "ok": true }
```

---

### POST /ingest

Ingest items by text or URL fetch.

**Request:**
```json
{
  "collection": "docs",
  "enrich": true,
  "items": [
    {
      "id": "my-repo:src/auth.ts",
      "text": "...",
      "source": "https://github.com/org/repo/blob/main/src/auth.ts",
      "docType": "code",
      "metadata": {
        "repoId": "my-repo",
        "path": "src/auth.ts",
        "lang": "ts"
      }
    }
  ]
}
```

**URL-based item:**
```json
{
  "items": [
    {
      "url": "https://example.com/article"
    }
  ]
}
```

- `collection` defaults to `docs`
- `items` is required (`1..1000`)
- Each item must provide `text` or `url`
- If `text` is used without `url`, `source` is required
- URL fetch mode supports partial success and returns `errors[]` per failed URL

**Response (example):**
```json
{
  "ok": true,
  "upserted": 12,
  "fetched": 1
}
```

---

### POST /query

Semantic search over chunks.

**Request:**
```json
{
  "collection": "docs",
  "query": "authentication flow",
  "topK": 8,
  "minScore": 0.5,
  "filter": {
    "repoId": "my-repo",
    "lang": "ts",
    "path": "src/"
  },
  "graphExpand": true
}
```

- `collection` defaults to `docs`
- `topK` range: `1..100` (default `8`)
- `minScore` range: `0..1`; when omitted, threshold is auto-derived from query term count
- `filter` supports allowed keys mapped to chunk columns (`chunkIndex`, `docType`, `repoId`, `repoUrl`, `path`, `lang`, `itemUrl`, `enrichmentStatus`)
- `graphExpand` adds related entities/relationships from the graph tables

**Response (example):**
```json
{
  "ok": true,
  "results": [
    {
      "id": "my-repo:src/auth.ts:0",
      "score": 0.82,
      "source": "https://github.com/org/repo/blob/main/src/auth.ts",
      "text": "...",
      "payload": {
        "chunkIndex": 0,
        "baseId": "my-repo:src/auth.ts",
        "docType": "code",
        "repoId": "my-repo",
        "path": "src/auth.ts",
        "lang": "ts",
        "tier1Meta": {},
        "tier2Meta": null,
        "tier3Meta": null,
        "docSummary": null,
        "docSummaryShort": null,
        "docSummaryMedium": null,
        "docSummaryLong": null,
        "payloadChecksum": "..."
      }
    }
  ],
  "graph": {
    "entities": [
      { "name": "AuthService", "type": "class" }
    ],
    "relationships": [
      { "source": "AuthService", "target": "JWT", "type": "uses" }
    ]
  }
}
```

---

### POST /query/download-first

Runs `/query`, resolves the first result document, and returns a downloadable file.

- Uses `documents.raw_data` when present
- Falls back to blob-store by `documents.raw_key` when present
- Returns `404` when query has no result, result has no `baseId`, document not found, or no raw payload exists
- Returns `502` when blob-store retrieval fails

**Request body:** same as `/query` except `graphExpand` is not accepted.

---

### POST /query/fulltext-first

Runs `/query`, resolves the first result document, fetches all chunks for that document, and returns concatenated plain text.

- Content-Type: `text/plain; charset=utf-8`
- Returns `404` for no query results or no chunks for the selected document

**Request body:** same as `/query/download-first`.

---

### GET /collections

Returns collection-level overview.

**Response:**
```json
{
  "ok": true,
  "collections": [
    {
      "collection": "docs",
      "documentCount": 5,
      "chunkCount": 20,
      "enrichedChunkCount": 15,
      "lastSeenAt": "2026-02-20T00:00:00.000Z"
    }
  ]
}
```

---

### GET /enrichment/status/:baseId

Returns enrichment status for all chunks of one document.

**Request example:**
```
GET /enrichment/status/my-repo:src/auth.ts?collection=docs
```

**Response fields:**
- `status`: `enriched | processing | pending | failed | none | mixed`
- `chunks`: per-status counts
- `extractedAt`: latest `enriched_at` timestamp when available
- `metadata.tier2`, `metadata.tier3`: latest enriched metadata snapshot
- `metadata.error`: extracted from `tier3_meta._error` for failed status, including `chunkIndex` when present

---

### GET /enrichment/stats

Returns queue and chunk totals, optionally filtered.

**Query params:**
- `collection` (default `docs`)
- `filter` (text filter)

**Response:**
```json
{
  "queue": {
    "pending": 10,
    "processing": 2,
    "deadLetter": 1
  },
  "totals": {
    "enriched": 150,
    "failed": 2,
    "pending": 10,
    "processing": 2,
    "none": 36
  }
}
```

Filter behavior uses full-text + ILIKE fallback. Invalid `websearch_to_tsquery` input automatically retries with ILIKE-only logic.

---

### POST /enrichment/enqueue

Enqueues enrichment tasks for chunks in a collection.

**Request:**
```json
{
  "collection": "docs",
  "force": false,
  "filter": "authentication OR auth"
}
```

- `force=false` skips already enriched chunks
- Optional `filter` scopes candidate chunks using full-text + ILIKE fallback

**Response:**
```json
{
  "ok": true,
  "enqueued": 25
}
```

---

### POST /enrichment/clear

Deletes queued enrichment tasks from `task_queue`.

**Request:**
```json
{
  "collection": "docs",
  "filter": "my-repo"
}
```

- Deletes only statuses: `pending`, `processing`, `dead`
- Does not delete completed/other statuses
- Optional `filter` supports full-text + ILIKE fallback

**Response:**
```json
{
  "ok": true,
  "cleared": 10
}
```

---

### GET /graph/entity/:name

Returns one entity with related connections and documents.

**Request example:**
```
GET /graph/entity/AuthService?limit=100
```

---

## Internal worker endpoints

Used by the enrichment worker:

- `POST /internal/tasks/claim`
- `POST /internal/tasks/:id/result`
- `POST /internal/tasks/:id/fail`
- `POST /internal/tasks/recover-stale`

These endpoints are authenticated like all non-`/healthz` routes.

