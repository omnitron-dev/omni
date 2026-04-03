import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { SpecsManager } from '../specs/manager.js';
import { Chunker } from '../embeddings/chunker.js';
import type {
  IKbSource,
  IKbStore,
  IEmbeddingProvider,
  IManifest,
  IModuleInfo,
  IExtractedData,
  IPackageOverview,
  IDependency,
} from '../core/types.js';

export interface IndexerOptions {
  /** Embedding provider (NullProvider if not configured) */
  embeddings: IEmbeddingProvider;
  /** Whether to use pre-built extraction from kb/generated/ */
  usePrebuilt?: boolean;
}

/**
 * Main indexer pipeline. Orchestrates:
 * 1. Discovery → sources
 * 2. Extraction (ts-morph or pre-built JSON)
 * 3. Specs parsing
 * 4. Embedding generation
 * 5. Storage in SurrealDB
 */
export class Indexer {
  private readonly specsManager = new SpecsManager();
  private readonly chunker = new Chunker();

  /**
   * Full index of all sources into the store.
   */
  async indexAll(
    sources: IKbSource[],
    store: IKbStore,
    options: IndexerOptions,
  ): Promise<void> {
    const allOverviews: IPackageOverview[] = [];
    const allDeps: IDependency[] = [];

    for (const source of sources) {
      await this.indexSource(source, store, options, allOverviews, allDeps);
    }

    // Store repo map as a special pattern entry
    if (allOverviews.length > 0) {
      const repoMap = this.repoMapGen.generate(allOverviews, allDeps);
      const repoMapText = this.repoMapGen.renderToText(
        repoMap.packages,
        repoMap.dependencyGraph,
      );
      await store.upsertPatterns([{
        name: 'repo-map',
        title: 'Repository Architecture Map',
        content: repoMapText,
        tags: ['architecture', 'overview', 'repo-map'],
      }]);
    }
  }

  /**
   * Incremental index — only re-index sources whose manifests have changed.
   */
  async indexChanged(
    sources: IKbSource[],
    store: IKbStore,
    options: IndexerOptions,
  ): Promise<{ indexed: number; skipped: number }> {
    let indexed = 0;
    let skipped = 0;
    const allOverviews: IPackageOverview[] = [];
    const allDeps: IDependency[] = [];

    for (const source of sources) {
      // Check manifest
      const stored = await store.getManifest(source.packageName);
      const current = await this.computeSourceHash(source);

      if (stored && stored.hash === current) {
        skipped++;
        continue;
      }

      await this.indexSource(source, store, options, allOverviews, allDeps);
      indexed++;
    }

    // Regenerate repo map if anything changed
    if (indexed > 0 && allOverviews.length > 0) {
      // Repo map generation (lazy import to avoid ts-morph dep)
      const { RepoMapGenerator } = await import('../extractors/repo-map/repo-map.generator.js');
      const repoMapGen = new RepoMapGenerator();
      const repoMap = repoMapGen.generate(allOverviews, allDeps);
      const repoMapText = repoMapGen.renderToText(
        repoMap.packages,
        repoMap.dependencyGraph,
      );
      await store.upsertPatterns([{
        name: 'repo-map',
        title: 'Repository Architecture Map',
        content: repoMapText,
        tags: ['architecture', 'overview', 'repo-map'],
      }]);
    }

    return { indexed, skipped };
  }

  /**
   * Index a single source into the store.
   */
  private async indexSource(
    source: IKbSource,
    store: IKbStore,
    options: IndexerOptions,
    allOverviews: IPackageOverview[],
    allDeps: IDependency[],
  ): Promise<void> {
    const { embeddings, usePrebuilt } = options;

    // 1. Store module info
    const moduleInfo: IModuleInfo = {
      path: source.config.module,
      package: source.packageName,
      name: source.config.name,
      summary: '',
      tags: source.config.tags,
      source: source.type,
      tokens: 0,
    };
    await store.upsertModule(moduleInfo);

    // 2. Load pre-built symbol extraction (from kb/generated/)
    // Live ts-morph extraction is done separately via kb-extract CLI
    let extraction: IExtractedData | null = null;

    if (source.config.extract.symbols && usePrebuilt) {
      extraction = await this.loadPrebuiltExtraction(source);
    }

    if (extraction) {
      await store.upsertSymbols(extraction.symbols);
      allOverviews.push(extraction.repoMap);
      allDeps.push(...extraction.dependencies);
      await store.upsertDependencies(extraction.dependencies);
      await store.upsertManifest(source.packageName, extraction.manifest);

      if (embeddings.dimension > 0 && extraction.symbols.length > 0) {
        const texts = extraction.symbols.map(s => `${s.name} ${s.signature} ${s.jsdoc ?? ''}`);
        try {
          const vectors = await embeddings.embedCode(texts);
          const symbolsWithEmbeddings = extraction.symbols.map((s, i) => ({
            ...s,
            embedding: vectors[i],
          }));
          await store.upsertSymbols(symbolsWithEmbeddings);
        } catch (err) {
          console.warn(`[kb:indexer] Embedding generation failed for symbols:`, err);
        }
      }
    }

    // 3. Load and store specs
    const specsCollection = await this.specsManager.loadFromSource(source);

    if (specsCollection.specs.length > 0) {
      // Generate embeddings for specs
      if (embeddings.dimension > 0) {
        const texts = specsCollection.specs.map(s => `${s.title} ${s.summary} ${s.content}`);
        try {
          const vectors = await embeddings.embedText(texts);
          specsCollection.specs.forEach((s, i) => {
            s.embedding = vectors[i];
          });
        } catch (err) {
          console.warn(`[kb:indexer] Embedding generation failed for specs:`, err);
        }
      }
      await store.upsertSpecs(specsCollection.specs);
    }

    if (specsCollection.gotchas.length > 0) {
      // Generate embeddings for gotchas
      if (embeddings.dimension > 0) {
        const texts = specsCollection.gotchas.map(g => `${g.title} ${g.content}`);
        try {
          const vectors = await embeddings.embedText(texts);
          specsCollection.gotchas.forEach((g, i) => {
            g.embedding = vectors[i];
          });
        } catch (err) {
          console.warn(`[kb:indexer] Embedding generation failed for gotchas:`, err);
        }
      }
      await store.upsertGotchas(specsCollection.gotchas);
    }

    if (specsCollection.patterns.length > 0) {
      if (embeddings.dimension > 0) {
        const texts = specsCollection.patterns.map(p => `${p.title} ${p.content}`);
        try {
          const vectors = await embeddings.embedText(texts);
          specsCollection.patterns.forEach((p, i) => {
            p.embedding = vectors[i];
          });
        } catch (err) {
          console.warn(`[kb:indexer] Embedding generation failed for patterns:`, err);
        }
      }
      await store.upsertPatterns(specsCollection.patterns);
    }
  }

  /**
   * Load pre-built extraction from kb/generated/ directory.
   */
  private async loadPrebuiltExtraction(source: IKbSource): Promise<IExtractedData | null> {
    try {
      const genDir = resolve(source.path, 'generated');
      const [symbols, decorators, deps, repoMap, manifest] = await Promise.all([
        readFile(resolve(genDir, 'symbols.json'), 'utf-8').then(JSON.parse),
        readFile(resolve(genDir, 'decorators.json'), 'utf-8').then(JSON.parse),
        readFile(resolve(genDir, 'dependencies.json'), 'utf-8').then(JSON.parse),
        readFile(resolve(genDir, 'repo-map.json'), 'utf-8').then(JSON.parse),
        readFile(resolve(genDir, 'manifest.json'), 'utf-8').then(JSON.parse),
      ]);
      return { symbols, decorators, dependencies: deps, repoMap, manifest };
    } catch {
      return null;
    }
  }

  /**
   * Compute a hash for the source to detect changes.
   */
  private async computeSourceHash(source: IKbSource): Promise<string> {
    // Quick hash: check if pre-built manifest exists and return its hash
    try {
      const manifestPath = resolve(source.path, 'generated', 'manifest.json');
      const raw = await readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(raw) as IManifest;
      return manifest.hash;
    } catch {
      // No pre-built manifest — hash the kb.config.ts + specs directory
      const configPath = resolve(source.path, 'kb.config.ts');
      try {
        const content = await readFile(configPath, 'utf-8');
        return createHash('sha256').update(content).digest('hex').slice(0, 32);
      } catch {
        return '';
      }
    }
  }
}
