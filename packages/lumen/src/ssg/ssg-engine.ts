import { renderDocumentHtml } from './render-html.js';
import { generateLlmsTxt } from '../ai/llms-txt.js';
import { generateLlmsFullTxt } from '../ai/llms-full.js';
import { generateRouteMirrors } from '../ai/route-mirrors.js';
import { generateSearchIndex } from '../search/index-builder.js';
import { generateAssetManifest, carryPreviousBuildForward } from '../manifest/generator.js';
import { computeContentHash, computeSriHash } from '../manifest/hashing.js';
import type { CorpusGraph } from '../corpus/graph.js';
import type { LumenConfig } from '../config/schema.js';
import type { AssetManifest } from '../manifest/types.js';

export interface SsgBuildOptions {
  outDir?: string;
  previousManifest?: AssetManifest | null;
  carryPreviousBuildForward?: boolean;
}

export interface SsgBuildResult {
  pagesCount: number;
  pages: Map<string, string>;
  mirrors: Map<string, string>;
  llmsTxt: string;
  llmsFullTxt: string;
  manifest: AssetManifest;
}

export async function buildStaticSite(
  corpus: CorpusGraph,
  config: LumenConfig,
  options?: SsgBuildOptions
): Promise<SsgBuildResult> {
  const documents = corpus.getAllDocuments();
  const pages = new Map<string, string>();
  const currentAssets: AssetManifest = {};

  // Concurrently render all HTML pages without cross-document state leakage (TC-B20-03)
  const renderPromises = documents.map(async (doc) => {
    const html = doc.ast
      ? renderDocumentHtml(doc.ast, {
          theme: config.theme?.defaultMode ?? 'dark',
          locale: doc.locale ?? config.defaultLocale,
          baseUrl: config.baseUrl,
        })
      : `<!DOCTYPE html><html><body><h1>${doc.title}</h1></body></html>`;

    const rawRoute = (doc.routePath ?? doc.path.replace(/\\/g, '/')).replace(/\.(pdx|md)$/, '');
    const route = rawRoute.startsWith('/') ? rawRoute : `/${rawRoute}`;
    const hash = computeContentHash(html);
    const sri = computeSriHash(html);

    currentAssets[`routes${route}.html`] = {
      path: `routes${route}.${hash}.html`,
      sri,
      hash,
    };

    return { route, html };
  });

  const rendered = await Promise.all(renderPromises);
  for (const { route, html } of rendered) {
    pages.set(route, html);
  }

  // Generate AI Agent endpoints
  const llmsTxt = generateLlmsTxt(corpus, config);
  const llmsFullTxt = generateLlmsFullTxt(corpus, config);
  const mirrors = generateRouteMirrors(corpus, config);

  currentAssets['llms.txt'] = `assets/llms.${computeContentHash(llmsTxt)}.txt`;
  currentAssets['llms-full.txt'] = `assets/llms-full.${computeContentHash(llmsFullTxt)}.txt`;

  // Generate Pagefind search index
  const searchResult = await generateSearchIndex(corpus, config);
  Object.assign(currentAssets, searchResult.manifestEntries);

  // Generate or carry forward asset manifest
  const manifest = options?.carryPreviousBuildForward
    ? carryPreviousBuildForward(options.previousManifest, currentAssets)
    : generateAssetManifest(currentAssets, {
        carryPreviousBuildForward: false,
      });

  return {
    pagesCount: pages.size,
    pages,
    mirrors,
    llmsTxt,
    llmsFullTxt,
    manifest,
  };
}
