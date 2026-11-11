/**
 * Heading Slugifier and Table of Contents (ToC) Generator
 */

import type { LumenTocItem } from '../ast/types.js';

export function extractHeadingIdAndTitle(rawText: string, index: number): { id: string; title: string } {
  const customIdMatch = rawText.match(/\s+\{#([a-zA-Z0-9_\u0400-\u04FF\u4E00-\u9FFF-]+)\}\s*$/);
  if (customIdMatch && customIdMatch[1]) {
    const id = customIdMatch[1];
    const title = rawText.replace(/\s+\{#[^}]+\}\s*$/, '').trim();
    return { id, title };
  }

  const title = rawText.trim();
  const slug = slugifyHeading(title);
  const id = slug || `heading-${index}`;
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
      const { id, title } = extractHeadingIdAndTitle(rawText, toc.length + 1);

      toc.push({
        id,
        title,
        level,
      });
    }
  }

  return toc;
}
