'use client';

import type { SxProps, Theme } from '@mui/material/styles';
import type { Options } from 'react-markdown';

import { TipTapRenderer } from '../tiptap-renderer/tiptap-renderer.js';
import type { TipTapDoc } from '../tiptap-renderer/tiptap-renderer.js';
import { Markdown } from './markdown.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Content can be:
 * - TipTap JSON document (object with `type: 'doc'` and `content` array)
 * - Markdown string
 * - HTML string (auto-converted to markdown)
 * - null/undefined (renders nothing)
 */
export type ContentValue = TipTapDoc | Record<string, unknown> | string | null | undefined;

export interface ContentRendererProps {
  /** The content to render — TipTap JSON, markdown string, or HTML string */
  content: ContentValue;
  /** Additional CSS class */
  className?: string;
  /** MUI sx prop */
  sx?: SxProps<Theme>;
  /** Compact mode for chat messages, comments, etc. */
  compact?: boolean;
  /** Custom react-markdown component overrides (only applies to markdown/HTML content) */
  markdownComponents?: Options['components'];
  /** Link component for internal navigation (e.g. react-router Link) */
  routerLinkComponent?: React.ElementType;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

function isTipTapDoc(value: unknown): value is TipTapDoc {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as any).type === 'doc' &&
    'content' in value &&
    Array.isArray((value as any).content)
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Unified content renderer that auto-detects the content format and delegates
 * to the appropriate renderer:
 *
 * - **TipTap JSON** → TipTapRenderer (recursive node-to-HTML mapping)
 * - **Markdown / HTML string** → Markdown (react-markdown with rehype-highlight)
 *
 * Both renderers share the same styled container (`ContentRoot`) ensuring
 * consistent typography, code highlighting, table styling, and dark mode support.
 */
export function ContentRenderer({
  content,
  className,
  sx,
  compact,
  markdownComponents,
  routerLinkComponent,
}: ContentRendererProps) {
  if (content == null) return null;

  // TipTap JSON document
  if (typeof content === 'object') {
    if (isTipTapDoc(content)) {
      return <TipTapRenderer content={content} className={className} sx={sx} compact={compact} />;
    }
    // Unknown object — try as TipTap anyway
    return <TipTapRenderer content={content as any} className={className} sx={sx} compact={compact} />;
  }

  // String content — markdown or HTML
  if (typeof content === 'string') {
    if (!content.trim()) return null;
    return (
      <Markdown
        className={className}
        sx={sx}
        compact={compact}
        components={markdownComponents}
        routerLinkComponent={routerLinkComponent}
      >
        {content}
      </Markdown>
    );
  }

  return null;
}
