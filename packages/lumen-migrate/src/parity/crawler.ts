import { parseSafeFrontmatter } from '../utils/safe-matter.js';
import {
  documentationRoot,
  documentationText,
  inventoryDocumentation,
  isDocumentationFile,
  type DocumentationInventory,
} from '../utils/documentation-files.js';
import { normalizeUrl } from './normalizer.js';

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
  const normalizedRel = relPath.replace(/\\/g, '/').replace(/\.(md|mdx|pdx)$/i, '');
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

export function crawlDocumentationInventory(inventory: DocumentationInventory): CrawledProjectUrls {
  const routeUrls: string[] = [],
    anchorUrls: string[] = [];
  const routes = new Map<string, string>();
  for (const file of inventory.files) {
    if (!isDocumentationFile(file.relativePath)) continue;
    try {
      const parsed = parseSafeFrontmatter(documentationText(file));
      const routeUrl = computeCanonicalRouteUrl(file.relativePath, parsed.data);
      const canonical = normalizeUrl(routeUrl);
      if (routes.has(canonical)) throw Error('Duplicate documentation route also declared by ' + routes.get(canonical));
      routes.set(canonical, file.relativePath);
      routeUrls.push(routeUrl);
      anchorUrls.push(...extractDocumentAnchors(parsed.content, routeUrl));
    } catch (cause) {
      throw new Error(
        'Cannot inventory documentation ' + file.path + ': ' + (cause instanceof Error ? cause.message : String(cause)),
        { cause }
      );
    }
  }
  return { routeUrls, anchorUrls, allUrls: [...routeUrls, ...anchorUrls] };
}

export function crawlDocumentationDirectory(dirPath: string): CrawledProjectUrls {
  return crawlDocumentationInventory(inventoryDocumentation(documentationRoot(dirPath)));
}
