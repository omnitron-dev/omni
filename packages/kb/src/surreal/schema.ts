/**
 * SurrealDB schema definitions for the Knowledge Base.
 * All statements use IF NOT EXISTS for idempotent application.
 */
export const KB_SCHEMA = `
-- ============================================================================
-- Namespace: omnitron / Database: kb
-- ============================================================================

-- Module: a package or submodule in the codebase
DEFINE TABLE IF NOT EXISTS module SCHEMALESS;
DEFINE FIELD IF NOT EXISTS path ON module TYPE string;
DEFINE FIELD IF NOT EXISTS package ON module TYPE string;
DEFINE FIELD IF NOT EXISTS name ON module TYPE string;
DEFINE FIELD IF NOT EXISTS summary ON module TYPE string;
DEFINE FIELD IF NOT EXISTS tags ON module TYPE array<string>;
DEFINE FIELD IF NOT EXISTS source ON module TYPE string;
DEFINE FIELD IF NOT EXISTS tokens ON module TYPE int;
DEFINE INDEX IF NOT EXISTS idx_module_path ON module FIELDS path UNIQUE;
DEFINE INDEX IF NOT EXISTS idx_module_package ON module FIELDS package;
DEFINE INDEX IF NOT EXISTS idx_module_source ON module FIELDS source;

-- Symbol: extracted class/interface/type/function/enum/const
-- SCHEMALESS to allow nested objects in members/decorators arrays
DEFINE TABLE IF NOT EXISTS symbol SCHEMALESS;
DEFINE FIELD IF NOT EXISTS name ON symbol TYPE string;
DEFINE FIELD IF NOT EXISTS kind ON symbol TYPE string;
DEFINE FIELD IF NOT EXISTS module ON symbol TYPE string;
DEFINE FIELD IF NOT EXISTS filePath ON symbol TYPE string;
DEFINE FIELD IF NOT EXISTS line ON symbol TYPE int;
DEFINE FIELD IF NOT EXISTS signature ON symbol TYPE string;
DEFINE FIELD IF NOT EXISTS jsdoc ON symbol TYPE option<string>;
DEFINE FIELD IF NOT EXISTS decorators ON symbol TYPE array<object>;
DEFINE FIELD IF NOT EXISTS members ON symbol TYPE array<object>;
DEFINE FIELD IF NOT EXISTS implements ON symbol TYPE option<array<string>>;
DEFINE FIELD IF NOT EXISTS extends ON symbol TYPE option<string>;
DEFINE FIELD IF NOT EXISTS exportPath ON symbol TYPE option<string>;
DEFINE FIELD IF NOT EXISTS embedding ON symbol TYPE option<array<float>>;
DEFINE INDEX IF NOT EXISTS idx_symbol_name ON symbol FIELDS name;
DEFINE INDEX IF NOT EXISTS idx_symbol_kind ON symbol FIELDS kind;
DEFINE INDEX IF NOT EXISTS idx_symbol_module ON symbol FIELDS module;

-- Spec: human-written conceptual documentation
DEFINE TABLE IF NOT EXISTS spec SCHEMALESS;
DEFINE FIELD IF NOT EXISTS module ON spec TYPE string;
DEFINE FIELD IF NOT EXISTS title ON spec TYPE string;
DEFINE FIELD IF NOT EXISTS content ON spec TYPE string;
DEFINE FIELD IF NOT EXISTS tags ON spec TYPE array<string>;
DEFINE FIELD IF NOT EXISTS summary ON spec TYPE string;
DEFINE FIELD IF NOT EXISTS filePath ON spec TYPE string;
DEFINE FIELD IF NOT EXISTS dependsOn ON spec TYPE array<string>;
DEFINE FIELD IF NOT EXISTS tokens ON spec TYPE int;
DEFINE FIELD IF NOT EXISTS embedding ON spec TYPE option<array<float>>;
DEFINE INDEX IF NOT EXISTS idx_spec_module ON spec FIELDS module;

-- Chunk: code fragment for embedding-based search
DEFINE TABLE IF NOT EXISTS chunk SCHEMALESS;
DEFINE FIELD IF NOT EXISTS source ON chunk TYPE string;
DEFINE FIELD IF NOT EXISTS range ON chunk TYPE object;
DEFINE FIELD IF NOT EXISTS content ON chunk TYPE string;
DEFINE FIELD IF NOT EXISTS symbol ON chunk TYPE option<string>;
DEFINE FIELD IF NOT EXISTS package ON chunk TYPE string;
DEFINE FIELD IF NOT EXISTS tokens ON chunk TYPE int;
DEFINE FIELD IF NOT EXISTS embedding ON chunk TYPE option<array<float>>;
DEFINE INDEX IF NOT EXISTS idx_chunk_package ON chunk FIELDS package;
DEFINE INDEX IF NOT EXISTS idx_chunk_source ON chunk FIELDS source;

-- Gotcha: critical pitfalls and warnings
DEFINE TABLE IF NOT EXISTS gotcha SCHEMALESS;
DEFINE FIELD IF NOT EXISTS title ON gotcha TYPE string;
DEFINE FIELD IF NOT EXISTS module ON gotcha TYPE option<string>;
DEFINE FIELD IF NOT EXISTS severity ON gotcha TYPE string;
DEFINE FIELD IF NOT EXISTS content ON gotcha TYPE string;
DEFINE FIELD IF NOT EXISTS tags ON gotcha TYPE array<string>;
DEFINE FIELD IF NOT EXISTS embedding ON gotcha TYPE option<array<float>>;
DEFINE INDEX IF NOT EXISTS idx_gotcha_module ON gotcha FIELDS module;
DEFINE INDEX IF NOT EXISTS idx_gotcha_severity ON gotcha FIELDS severity;

-- Pattern: development patterns with code examples
DEFINE TABLE IF NOT EXISTS pattern SCHEMALESS;
DEFINE FIELD IF NOT EXISTS name ON pattern TYPE string;
DEFINE FIELD IF NOT EXISTS title ON pattern TYPE string;
DEFINE FIELD IF NOT EXISTS content ON pattern TYPE string;
DEFINE FIELD IF NOT EXISTS tags ON pattern TYPE array<string>;
DEFINE FIELD IF NOT EXISTS embedding ON pattern TYPE option<array<float>>;
DEFINE INDEX IF NOT EXISTS idx_pattern_name ON pattern FIELDS name UNIQUE;

-- Manifest: file hash tracking for incremental indexing
DEFINE TABLE IF NOT EXISTS manifest SCHEMALESS;
DEFINE FIELD IF NOT EXISTS package ON manifest TYPE string;
DEFINE FIELD IF NOT EXISTS files ON manifest TYPE object;
DEFINE FIELD IF NOT EXISTS hash ON manifest TYPE string;
DEFINE FIELD IF NOT EXISTS extractedAt ON manifest TYPE string;
DEFINE FIELD IF NOT EXISTS packageVersion ON manifest TYPE string;
DEFINE INDEX IF NOT EXISTS idx_manifest_package ON manifest FIELDS package UNIQUE;

-- ============================================================================
-- Graph Relations (SurrealDB native relations)
-- ============================================================================

-- Dependencies (stored as records for portability)
DEFINE TABLE IF NOT EXISTS depends_on SCHEMALESS;
DEFINE FIELD IF NOT EXISTS \`in\` ON depends_on TYPE string;
DEFINE FIELD IF NOT EXISTS out ON depends_on TYPE string;
DEFINE FIELD IF NOT EXISTS kind ON depends_on TYPE string;
`;

/**
 * Schema for HNSW vector indexes (applied only when embeddings are enabled).
 * Separated because HNSW indexes require the embedding dimension to be known.
 */
export function getVectorIndexSchema(dimension: number): string {
  return `
-- Vector indexes (HNSW) for semantic search
DEFINE INDEX IF NOT EXISTS idx_symbol_vec ON symbol FIELDS embedding HNSW DIMENSION ${dimension} DIST COSINE;
DEFINE INDEX IF NOT EXISTS idx_spec_vec ON spec FIELDS embedding HNSW DIMENSION ${dimension} DIST COSINE;
DEFINE INDEX IF NOT EXISTS idx_chunk_vec ON chunk FIELDS embedding HNSW DIMENSION ${dimension} DIST COSINE;
DEFINE INDEX IF NOT EXISTS idx_gotcha_vec ON gotcha FIELDS embedding HNSW DIMENSION ${dimension} DIST COSINE;
DEFINE INDEX IF NOT EXISTS idx_pattern_vec ON pattern FIELDS embedding HNSW DIMENSION ${dimension} DIST COSINE;
`;
}
