import { publishGeneration, type StaticFile } from './publish-generation.js';
import React from 'react';
import { resolveExampleSources } from '../corpus/examples.js';
import { buildClientAssets } from './client-build.js';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { LumenNode } from '@omnitron-dev/lumen-ast';
import { BASE_LUMEN_THEME_CSS } from './emotion-extractor.js';
import { FILE_TREE_CSS } from './file-tree-styles.js';
import { escapeHtml } from './assemble-html.js';
import { renderDocumentHtml } from './render-html.js';
import { generateLlmsTxt } from '../ai/llms-txt.js';
import { generateLlmsFullTxt } from '../ai/llms-full.js';
import { generateRouteMirrors } from '../ai/route-mirrors.js';
import { markdownMirrorPath } from '../corpus/routes.js';
import { buildSearchIndex } from '../search/index-builder.js';
import { generateAssetManifest } from '../manifest/generator.js';
import { computeContentHash, computeSriHash } from '../manifest/hashing.js';
import { projectCorpus, type CorpusProjectionOptions } from '../corpus/projection.js';
import type { CorpusGraph } from '../corpus/graph.js';
import type { LumenConfig } from '../config/schema.js';
import type { AssetManifest } from '../manifest/types.js';

export interface SsgBuildOptions extends CorpusProjectionOptions {
  rootDir?: string;
  clientAssets?: Map<string, string | Uint8Array>;
  clientScripts?: string[];
  clientStyles?: string[];
  outDir?: string;
  writeToDisk?: boolean;
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
  assets: Map<string, string | Uint8Array>;
  outDir?: string;
  writtenFiles?: string[];
}

function normalizeBaseUrl(baseUrl?: string): string {
  if (!baseUrl || !baseUrl.trim()) {
    return '/';
  }
  let normalized = baseUrl.trim();
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }
  if (!normalized.endsWith('/')) {
    normalized = `${normalized}/`;
  }
  return normalized;
}

function createClientStylesheet(): string {
  return [
    BASE_LUMEN_THEME_CSS,
    FILE_TREE_CSS,
    '.lumen-doc h1,.lumen-doc h2,.lumen-doc h3,.lumen-doc h4{color:var(--lumen-fg);line-height:1.3;margin-top:1.75em;margin-bottom:0.6em;}',
    '.lumen-doc a{color:var(--lumen-accent);text-decoration:none;}',
    '.lumen-doc a:hover{text-decoration:underline;}',
    '.lumen-doc pre,.lumen-doc code{font-family:var(--lumen-font-mono);background:var(--lumen-code-bg);border-radius:6px;}',
    '.lumen-doc pre{padding:1rem;overflow-x:auto;border:1px solid var(--lumen-border);}',
    '.lumen-math-block,.lumen-admonition{border:1px solid var(--lumen-border);background:var(--lumen-surface);border-radius:8px;padding:1rem 1.25rem;margin:1.25rem 0;}',
    '.lumen-portal-island{display:block;position:relative;}',
  ].join('\n');
}

export async function buildStaticSite(
  corpus: CorpusGraph,
  config: LumenConfig,
  options?: SsgBuildOptions
): Promise<SsgBuildResult> {
  const audience: CorpusProjectionOptions = {
    roles: options?.roles ?? ['anonymous'],
    accessFilter: options?.accessFilter,
  };
  const projectedCorpus = projectCorpus(corpus, audience);
  resolveExampleSources(projectedCorpus, config, options?.rootDir ?? process.cwd());
  const documents = projectedCorpus.getAllDocuments();

  const hasIslands = (nodes: LumenNode[]): boolean =>
    nodes.some((node) => node.type === 'jsxWidget' || node.type === 'diagram' ||
      (Array.isArray(node.children) && hasIslands(node.children)));
  const needsClient = Boolean(config.clientEntry) || documents.some((doc) => hasIslands(doc.ast?.children ?? []));
  const client =
    !options?.clientAssets && needsClient
      ? await buildClientAssets(options?.rootDir ?? process.cwd(), config)
      : { assets: options?.clientAssets, scripts: options?.clientScripts, styles: options?.clientStyles };

  const pages = new Map<string, string>();
  const assets = new Map<string, string | Uint8Array>(client.assets);
  const currentAssets: AssetManifest = {};
  const normalizedBase = normalizeBaseUrl(config.baseUrl);
  const assetUrl = (path: string) =>
    /^(https?:)?\/\//.test(path) ? path : `${normalizedBase}${path.replace(/^\/+/, '')}`;

  if (config.publicDir) {
    const publicDir = resolve(options?.rootDir ?? process.cwd(), config.publicDir);
    if (!existsSync(publicDir)) throw new Error(`Public asset directory does not exist: ${publicDir}`);
    const root = realpathSync(publicDir);
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const source = join(directory, entry.name);
        const real = realpathSync(source);
        if (real !== root && !real.startsWith(root + sep)) throw new Error(`Public asset escapes its root: ${source}`);
        if (entry.isSymbolicLink()) throw new Error(`Public assets must not contain symlinks: ${source}`);
        if (entry.isDirectory()) walk(source);
        else if (entry.isFile()) {
          const target = relative(root, source).replace(/\\/g, '/');
          if (assets.has(target)) throw new Error(`Duplicate public asset: ${target}`);
          assets.set(target, readFileSync(source));
        }
      }
    };
    walk(root);
  }

  // The same resolved links are used by HTML and Markdown mirrors. Source-relative
  // .pdx/.md links must never leak into public navigation after route customisation.
  for (const doc of documents) {
    const rewrite = (nodes: LumenNode[]): LumenNode[] =>
      nodes.map((node) => {
        const next = { ...node, ...(Array.isArray(node.children) ? { children: rewrite(node.children) } : {}) };
        if (node.type === 'link' && typeof node.url === 'string' && !node.url.startsWith('#')) {
          const resolved = projectedCorpus.resolveLink(doc.id, node.url);
          const target = resolved.targetDocId ? projectedCorpus.getDocument(resolved.targetDocId) : undefined;
          if (target?.routePath) {
            const hash = node.url.includes('#') ? node.url.slice(node.url.indexOf('#')) : '';
            const originalPath = node.url.split('#', 1)[0];
            const publicPath = originalPath === markdownMirrorPath(target.routePath) ? originalPath : target.routePath;
            next.url = `${normalizedBase}${publicPath.replace(/^\//, '')}${hash}`;
          }
        }
        return next;
      });
    if (doc.ast) doc.ast = { ...doc.ast, children: rewrite(doc.ast.children ?? []) };
  }

  // 1. Deterministic client CSS and Portal Island ESM bootstrapper bundles
  const stylesCss = createClientStylesheet();
  const stylesHash = computeContentHash(stylesCss);
  const stylesSri = computeSriHash(stylesCss);
  const stylesRelPath = `assets/lumen-styles.${stylesHash}.css`;

  assets.set(stylesRelPath, stylesCss);
  currentAssets['lumen-styles.css'] = {
    path: stylesRelPath,
    sri: stylesSri,
    sizeBytes: Buffer.byteLength(stylesCss),
    hash: stylesHash,
  };
  const stylesheetLinkTag = `<link rel="stylesheet" href="${normalizedBase}${stylesRelPath}" />`;

  // 2. Concurrently render all projected HTML pages without cross-document state leakage (TC-B20-03)
  const renderPromises = documents.map(async (doc) => {
    const rawRoute = (doc.routePath ?? doc.path.replace(/\\/g, '/')).replace(/\.(pdx|md)$/, '');
    const route = rawRoute.startsWith('/') ? rawRoute : `/${rawRoute}`;

    const html = doc.ast
      ? renderDocumentHtml(doc.ast, {
          theme: config.theme?.defaultMode ?? 'dark',
          macros: config.katexMacros,
          locale: doc.locale ?? config.defaultLocale,
          baseUrl: config.baseUrl,
          currentPath: route,
          extraHead: [
            stylesheetLinkTag,
            ...[...(config.stylesheets ?? []), ...(client.styles ?? [])].map(
              (path) => `<link rel="stylesheet" href="${escapeHtml(assetUrl(path))}" />`
            ),
            ...(config.url
              ? [`<link rel="canonical" href="${escapeHtml(config.url.replace(/\/$/, '') + assetUrl(route))}" />`]
              : []),
          ],
          bodyScripts: [
            ...(client.scripts ?? []).map(
              (path) => `<script type="module" src="${escapeHtml(assetUrl(path))}"></script>`
            ),
          ],
          renderLayout: config.theme.layout
            ? (children) => React.createElement(config.theme.layout!, { children, document: doc, documents, config })
            : undefined,
          ...audience,
        })
      : `<!DOCTYPE html><html><head>${stylesheetLinkTag}</head><body><h1>${escapeHtml(doc.title || doc.id)}</h1></body></html>`;

    const hash = computeContentHash(html);
    const sri = computeSriHash(html);

    currentAssets[`routes${route}.html`] = {
      path: route === '/' ? 'index.html' : route.slice(1) + (config.trailingSlash ? '/index.html' : '.html'),
      sri,
      sizeBytes: Buffer.byteLength(html, 'utf8'),
      hash,
    };

    return { route, html };
  });

  const rendered = await Promise.all(renderPromises);
  for (const { route, html } of rendered) {
    if (pages.has(route)) throw new Error(`Duplicate output route: ${route}`);
    pages.set(route, html);
  }

  // 3. Generate AI Agent endpoints strictly from projected public corpus
  const llmsTxt = generateLlmsTxt(projectedCorpus, config, audience);
  const llmsFullTxt = generateLlmsFullTxt(projectedCorpus, config, audience);
  const mirrors = generateRouteMirrors(projectedCorpus, config, audience);

  currentAssets['llms.txt'] = 'llms.txt';
  currentAssets['llms-full.txt'] = 'llms-full.txt';

  // 4. Generate Pagefind search index shards + portable ESM runtime strictly from projected public corpus
  const searchResult = await buildSearchIndex(projectedCorpus, config, audience);
  Object.assign(currentAssets, searchResult.manifestEntries);
  for (const [relPath, fileContent] of Object.entries(searchResult.files)) {
    assets.set(relPath, fileContent);
  }

  // A generation inventories exactly the bytes it emits, never previous routes.
  for (const [path, content] of assets) {
    currentAssets[path] = {
      path,
      hash: computeContentHash(content),
      sri: computeSriHash(content),
      sizeBytes: Buffer.byteLength(content),
    };
  }
  for (const [path, content] of mirrors) {
    if (path.endsWith('.md'))
      currentAssets[path] = {
        path: path.replace(/^\//, ''),
        hash: computeContentHash(content),
        sri: computeSriHash(content),
        sizeBytes: Buffer.byteLength(content),
      };
  }
  const manifest = generateAssetManifest(currentAssets);
  assets.set('asset-manifest.json', JSON.stringify(manifest, null, 2));

  // 6. Optional disk materialization
  let resolvedOutDir: string | undefined;
  let writtenFiles: string[] | undefined;

  if (options?.writeToDisk) {
    resolvedOutDir = resolve(options.outDir ?? config.outDir ?? 'dist');

    const files = new Map<string, StaticFile>();
    const writeSafeDiskFile = (path: string, content: StaticFile) => {
      const key = path.replace(/^\/+/, '');
      if (files.has(key)) throw new Error(`Output collision: ${key}`);
      files.set(key, content);
    };

    for (const [route, html] of pages.entries()) {
      const cleanRoute = route === '/' ? 'index' : route.replace(/^\/+/, '');
      const htmlRelPath = cleanRoute.endsWith('.html')
        ? cleanRoute
        : config.trailingSlash && route !== '/'
          ? `${cleanRoute}/index.html`
          : `${cleanRoute}.html`;
      writeSafeDiskFile(htmlRelPath, html);
    }

    writeSafeDiskFile('llms.txt', llmsTxt);
    writeSafeDiskFile('llms-full.txt', llmsFullTxt);

    for (const [mirrorKey, mdContent] of mirrors.entries()) {
      if (mirrorKey.endsWith('.md')) {
        writeSafeDiskFile(mirrorKey, mdContent);
      }
    }

    for (const [assetPath, assetContent] of assets.entries()) {
      writeSafeDiskFile(assetPath, assetContent);
    }

    writtenFiles = publishGeneration(resolvedOutDir, files);
  }

  return {
    pagesCount: pages.size,
    pages,
    mirrors,
    llmsTxt,
    llmsFullTxt,
    manifest,
    assets,
    ...(resolvedOutDir ? { outDir: resolvedOutDir } : {}),
    ...(writtenFiles ? { writtenFiles } : {}),
  };
}
