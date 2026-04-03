// ---------------------------------------------------------------------------
// @omnitron-dev/kb — Public API
// ---------------------------------------------------------------------------

// Core
export { KnowledgeBase } from './core/knowledge-base.js';
export type * from './core/types.js';

// Define helper (for third-party kb.config.ts)
export { defineKnowledge } from './define.js';

// Discovery
export { KnowledgeDiscovery } from './discovery/discovery.js';

// Extractors (available via '@omnitron-dev/kb/extractors' — separate build with ts-morph)

// Specs
export { SpecsManager } from './specs/manager.js';
export { SpecsParser } from './specs/parser.js';

// Embeddings
export { NullEmbeddingProvider } from './embeddings/providers/null.provider.js';

// Indexer
export { Indexer } from './indexer/indexer.js';
