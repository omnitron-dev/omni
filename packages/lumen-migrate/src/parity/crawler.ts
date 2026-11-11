import { join, resolve, relative } from 'node:path';
import { statSync, existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';

import { parseSafeFrontmatter, inspectPathContainment, DisabledFrontmatterEngineError } from '../utils/safe-matter.js';

export interface CrawledProjectUrls {
  routeUrls: string[];
  anchorUrls: string[];
  allUrls: string[];
}

const TRAILING_HEADING_ATTR_RE = /\s+\{([^{}]+)\}\s*$/;

function slugifyHeadingForParity(text: string): string {
  const clean = text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\{#[^}]+\}/g, '')
    .replace(/[$`*_~]/g, '')
    .trim();

  return clean
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/(^-|-$)/g, '');
}

function extractHeadingAnchorId(rawHeadingText: string, index: number): string {
  const attrMatch = rawHeadingText.match(TRAILING_HEADING_ATTR_RE);
  if (attrMatch && attrMatch[1]) {
    const inner = attrMatch[1].trim();
    const customIdMatch = inner.match(/^#([\p{L}\p{N}_:-]+)(?:\s|$)/u);
    if (customIdMatch && customIdMatch[1]) {
      return customIdMatch[1];
    }
    if (/^[a-zA-Z_][a-zA-Z0-9_:-]*\s*=/.test(inner)) {
      const explicitIdMatch = inner.match(/(?:^|\s)id\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s}]+))/);
      const explicitId = explicitIdMatch?.[1] ?? explicitIdMatch?.[2] ?? explicitIdMatch?.[3];
      if (explicitId && explicitId.trim()) {
        return explicitId.trim();
      }
      const cleanTitle = rawHeadingText.replace(TRAILING_HEADING_ATTR_RE, '').trim();
      return slugifyHeadingForParity(cleanTitle) || `heading-${index}`;
    }
  }

  return slugifyHeadingForParity(rawHeadingText.trim()) || `heading-${index}`;
}

function computeCanonicalRouteUrl(relPath: string, frontmatter: Record<string, unknown>): string {
  const normalizedRel = relPath.replace(/\\/g, '/').replace(/\.(md|mdx|pdx)$/, '');
  const slashIdx = normalizedRel.lastIndexOf('/');
  const dirPart = slashIdx >= 0 ? normalizedRel.slice(0, slashIdx) : '';

  const rawSlug = typeof frontmatter['slug'] === 'string' ? frontmatter['slug'].trim() : '';
  if (rawSlug) {
    if (rawSlug === '/') {
      return '/docs';
    }
    if (rawSlug.startsWith('/docs/') || rawSlug === '/docs') {
      return rawSlug.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
    }
    if (rawSlug.startsWith('/')) {
      return `/docs${rawSlug}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
    }
    const combinedSlug = dirPart ? `${dirPart}/${rawSlug}` : rawSlug;
    return `/docs/${combinedSlug}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  }

  const rawId = typeof frontmatter['id'] === 'string' ? frontmatter['id'].trim() : '';
  let routeId = normalizedRel;
  if (rawId) {
    const cleanId = rawId.replace(/^\/+/, '');
    if (cleanId === 'index') {
      routeId = dirPart;
    } else if (dirPart && !cleanId.startsWith(`${dirPart}/`)) {
      routeId = `${dirPart}/${cleanId}`;
    } else {
      routeId = cleanId;
    }
  } else if (routeId.endsWith('/index')) {
    routeId = routeId.slice(0, -'/index'.length);
  } else if (routeId === 'index') {
    routeId = '';
  }

  return `/docs/${routeId}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

function extractDocumentAnchors(body: string, routeUrl: string): string[] {
  const seen = new Set<string>();
  const anchors: string[] = [];
  const addAnchor = (id: string): void => {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    anchors.push(`${routeUrl}#${trimmed}`);
  };

  const lines = body.split('\n');
  let activeFence: { char: string; length: number } | null = null;
  let headingIndex = 0;

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch && fenceMatch[1]) {
      const fenceSeq = fenceMatch[1];
      const fenceChar = fenceSeq[0] ?? '`';
      if (!activeFence) {
        activeFence = { char: fenceChar, length: fenceSeq.length };
        continue;
      }
      if (
        activeFence.char === fenceChar &&
        fenceSeq.length >= activeFence.length &&
        /^\s*(?:`{3,}|~{3,})\s*$/.test(line)
      ) {
        activeFence = null;
        continue;
      }
    }

    if (activeFence) {
      continue;
    }

    const headingMatch = line.match(/^\s*(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/);
    if (headingMatch && headingMatch[2]) {
      headingIndex += 1;
      const headingId = extractHeadingAnchorId(headingMatch[2], headingIndex);
      addAnchor(headingId);
    } else {
      const customAnchorRegex = /\{#([\p{L}\p{N}_:-]+)\}/gu;
      let customMatch: RegExpExecArray | null = customAnchorRegex.exec(line);
      while (customMatch !== null) {
        if (customMatch[1]) {
          addAnchor(customMatch[1]);
        }
        customMatch = customAnchorRegex.exec(line);
      }
    }

    const htmlAnchorRegex = /<(?:a|span|div|section|h[1-6])\s+[^>]*\bid=["']([^"']+)["'][^>]*>/gi;
    let htmlMatch: RegExpExecArray | null = htmlAnchorRegex.exec(line);
    while (htmlMatch !== null) {
      if (htmlMatch[1]) {
        addAnchor(htmlMatch[1]);
      }
      htmlMatch = htmlAnchorRegex.exec(line);
    }
  }

  return anchors;
}

export function crawlDocumentationDirectory(dirPath: string): CrawledProjectUrls {
  const routeUrls: string[] = [];
  const anchorUrls: string[] = [];

  if (!dirPath || !existsSync(dirPath)) {
    return { routeUrls, anchorUrls, allUrls: [] };
  }

  let projectRootReal: string;
  try {
    projectRootReal = realpathSync(dirPath);
  } catch {
    return { routeUrls, anchorUrls, allUrls: [] };
  }

  const candidateDocsDir = resolve(dirPath, 'docs');
  let docsDir = dirPath;
  if (existsSync(candidateDocsDir)) {
    const docsCheck = inspectPathContainment(projectRootReal, candidateDocsDir);
    if (docsCheck.escaped) {
      return { routeUrls, anchorUrls, allUrls: [] };
    }
    docsDir = candidateDocsDir;
  }

  if (!existsSync(docsDir)) {
    return { routeUrls, anchorUrls, allUrls: [] };
  }

  let docsRootReal: string;
  try {
    docsRootReal = realpathSync(docsDir);
  } catch {
    return { routeUrls, anchorUrls, allUrls: [] };
  }

  const visitedDirs = new Set<string>();

  const crawl = (currentDir: string): void => {
    const dirCheck = inspectPathContainment(docsRootReal, currentDir);
    if (dirCheck.escaped || visitedDirs.has(dirCheck.realPath)) {
      return;
    }
    visitedDirs.add(dirCheck.realPath);

    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      const check = inspectPathContainment(docsRootReal, fullPath);
      if (check.escaped) {
        continue;
      }

      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (check.isSymlink) {
        try {
          const targetStat = statSync(check.realPath);
          isDir = targetStat.isDirectory();
          isFile = targetStat.isFile();
        } catch {
          continue;
        }
      }

      if (isDir) {
        crawl(fullPath);
      } else if (isFile && (entry.name.endsWith('.md') || entry.name.endsWith('.mdx') || entry.name.endsWith('.pdx'))) {
        try {
          const content = readFileSync(fullPath, 'utf8');
          const parsed = parseSafeFrontmatter(content);
          const relPath = relative(docsDir, fullPath);
          const routeUrl = computeCanonicalRouteUrl(relPath, parsed.data);
          routeUrls.push(routeUrl);

          const docAnchors = extractDocumentAnchors(parsed.content, routeUrl);
          anchorUrls.push(...docAnchors);
        } catch (err) {
          if (err instanceof DisabledFrontmatterEngineError) {
            continue;
          }
        }
      }
    }
  };

  crawl(docsDir);

  return {
    routeUrls,
    anchorUrls,
    allUrls: [...routeUrls, ...anchorUrls],
  };
}
