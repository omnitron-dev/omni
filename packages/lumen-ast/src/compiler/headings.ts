/**
 * Heading Slugifier and Table of Contents (ToC) Generator
 */

import type { LumenNode, LumenTocEntry, LumenTocItem } from '../ast/types.js';
import { parseAttributeString } from './lexer-attrs.js';

export interface HeadingMetadata {
  id: string;
  title: string;
  access?: string;
  attributes?: Record<string, unknown>;
  hasTrailingAttrBlock: boolean;
}

const TRAILING_HEADING_ATTR_RE = /\s+\{([^{}]+)\}\s*$/;

export function extractHeadingMetadata(rawText: string, index: number): HeadingMetadata {
  const attrBlockMatch = rawText.match(TRAILING_HEADING_ATTR_RE);
  if (attrBlockMatch && attrBlockMatch[1]) {
    const inner = attrBlockMatch[1].trim();
    const startsWithCustomId = /^#([\p{L}\p{N}_-]+)/u.test(inner);
    const startsWithKeyVal = /^[a-zA-Z_][a-zA-Z0-9_:-]*\s*=/.test(inner);

    if (startsWithCustomId || startsWithKeyVal) {
      let customId: string | undefined;
      let restAttrs = inner;
      if (startsWithCustomId) {
        const idMatch = inner.match(/^#([\p{L}\p{N}_-]+)(.*)$/u);
        if (idMatch && idMatch[1]) {
          customId = idMatch[1];
          restAttrs = (idMatch[2] ?? '').trim();
        }
      }

      const parsedAttrs = restAttrs ? parseAttributeString(restAttrs) : {};
      if (customId) {
        parsedAttrs['id'] = customId;
      }

      const cleanTitle = rawText.replace(TRAILING_HEADING_ATTR_RE, '').trim();
      const resolvedId =
        customId ??
        (typeof parsedAttrs['id'] === 'string' && parsedAttrs['id'].trim()
          ? parsedAttrs['id'].trim()
          : slugifyHeading(cleanTitle) || `heading-${index}`);
      const access = typeof parsedAttrs['access'] === 'string' ? parsedAttrs['access'] : undefined;

      return {
        id: resolvedId,
        title: cleanTitle,
        access,
        attributes: Object.keys(parsedAttrs).length > 0 ? parsedAttrs : undefined,
        hasTrailingAttrBlock: true,
      };
    }
  }

  const title = rawText.trim();
  const slug = slugifyHeading(title);
  const id = slug || `heading-${index}`;
  return { id, title, hasTrailingAttrBlock: false };
}

export function extractHeadingIdAndTitle(rawText: string, index: number): { id: string; title: string } {
  const { id, title } = extractHeadingMetadata(rawText, index);
  return { id, title };
}

export function slugifyHeading(text: string): string {
  // Strip HTML tags and markdown formatting like bold/italic, while preserving TeX symbols
  const clean = text
    .replace(/<[^>]+>/g, '')
    .replace(/\{#[^}]+\}/g, '')
    .replace(/[$`*_~]/g, '')
    .trim();

  const slug = clean
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/(^-|-$)/g, '');

  return slug;
}

export function serializeHeadingInlineText(nodes: LumenNode[]): string {
  return nodes
    .map((node) => {
      if (!node || typeof node !== 'object') return '';
      switch (node.type) {
        case 'text':
          return String(node.value ?? '');
        case 'inlineCode':
          return `\`${String(node.value ?? '')}\``;
        case 'mathInline':
          return `$${String(node.tex ?? node.value ?? '')}$`;
        case 'smartRef':
          return String(node.raw ?? `@${node.domain ?? 'ref'}:${node.target ?? ''}`);
        case 'strong':
          return `**${serializeHeadingInlineText(Array.isArray(node.children) ? node.children : [])}**`;
        case 'emphasis':
          return `*${serializeHeadingInlineText(Array.isArray(node.children) ? node.children : [])}*`;
        case 'delete':
          return `~~${serializeHeadingInlineText(Array.isArray(node.children) ? node.children : [])}~~`;
        case 'link':
          return serializeHeadingInlineText(Array.isArray(node.children) ? node.children : []);
        default: {
          if (Array.isArray(node.children)) {
            return serializeHeadingInlineText(node.children);
          }
          if (node.value !== undefined && node.value !== null) {
            return String(node.value);
          }
          return '';
        }
      }
    })
    .join('');
}

export function stripTrailingHeadingAttrFromChildren(children: LumenNode[]): LumenNode[] {
  if (children.length === 0) return children;
  const copy = [...children];
  const lastIdx = copy.length - 1;
  const last = copy[lastIdx];
  if (last && last.type === 'text' && typeof last.value === 'string') {
    const updated = last.value.replace(TRAILING_HEADING_ATTR_RE, '');
    if (updated !== last.value) {
      if (updated.length === 0 && copy.length > 1) {
        copy.pop();
      } else {
        copy[lastIdx] = { ...last, value: updated };
      }
    }
  }
  return copy;
}

export function computeTocFromNodes(nodes: LumenNode[]): LumenTocEntry[] {
  const toc: LumenTocEntry[] = [];
  if (!Array.isArray(nodes)) {
    return toc;
  }

  const walk = (items: LumenNode[], inheritedAccess?: string): void => {
    for (const node of items) {
      if (!node || typeof node !== 'object') {
        continue;
      }

      const propsObj = node.props as Record<string, unknown> | undefined;
      const ownAccess =
        typeof node.access === 'string' && node.access.trim()
          ? node.access.trim()
          : typeof node.attributes?.['access'] === 'string' && String(node.attributes['access']).trim()
            ? String(node.attributes['access']).trim()
            : typeof propsObj?.['access'] === 'string' && String(propsObj['access']).trim()
              ? String(propsObj['access']).trim()
              : undefined;

      const effectiveAccess = ownAccess ?? inheritedAccess;

      if (node.type === 'heading') {
        const rawDepth = Math.floor(Number(node.depth ?? 1)) || 1;
        const level = Math.max(1, Math.min(6, rawDepth));
        const rawInline = Array.isArray(node.children) ? serializeHeadingInlineText(node.children) : '';
        const meta = extractHeadingMetadata(rawInline, toc.length + 1);
        const id = typeof node.id === 'string' && node.id.trim() ? node.id.trim() : meta.id;
        const resolvedAccess = meta.access ?? effectiveAccess;

        const entry: LumenTocEntry = {
          id,
          title: meta.title,
          level,
          ...(resolvedAccess !== undefined ? { access: resolvedAccess } : {}),
        };
        toc.push(entry);
        continue;
      }

      if (Array.isArray(node.children) && node.children.length > 0) {
        walk(node.children, effectiveAccess);
      }
    }
  };

  walk(nodes, undefined);
  return toc;
}

export function buildTableOfContents(lines: string[]): LumenTocItem[] {
  const toc: LumenTocItem[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    // Track fenced code blocks to ignore markdown headings inside code
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const hashes = match[1] ?? '#';
      const rawText = (match[2] ?? '').trim();
      const level = hashes.length;
      const meta = extractHeadingMetadata(rawText, toc.length + 1);

      toc.push({
        id: meta.id,
        title: meta.title,
        level,
        ...(meta.access !== undefined ? { access: meta.access } : {}),
      });
    }
  }

  return toc;
}
