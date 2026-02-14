export const ingestSchema = {
  body: {
    type: "object" as const,
    required: ["items"],
    properties: {
      collection: { type: "string" as const },
      enrich: { type: "boolean" as const },
      items: {
        type: "array" as const,
        minItems: 1,
        items: {
          type: "object" as const,
          required: ["text", "source"],
          properties: {
            id: { type: "string" as const },
            text: { type: "string" as const, minLength: 1, pattern: "\\S" },
            source: { type: "string" as const, minLength: 1, pattern: "\\S" },
            docType: {
              type: "string" as const,
              enum: ["code", "slack", "email", "meeting", "pdf", "image", "article", "text"],
            },
            metadata: { type: "object" as const },
          },
        },
      },
    },
  },
};

export const querySchema = {
  body: {
    type: "object" as const,
    required: ["query"],
    properties: {
      collection: { type: "string" as const },
      query: { type: "string" as const, minLength: 1, pattern: "\\S" },
      topK: { type: "integer" as const, minimum: 1, maximum: 100 },
      filter: { type: "object" as const },
    },
  },
};
