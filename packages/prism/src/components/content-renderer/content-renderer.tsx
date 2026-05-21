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

/**
 * Detect a string that is a JSON-serialised TipTap doc. The
 * comments composer saves the editor state via `editor.getJSON()`
 * then `JSON.stringify(...)`; without this hop the string ends
 * up in the markdown branch and the page prints the raw JSON
 * literal (`{"type":"doc","content":[...]}`) instead of the
 * formatted comment body. Cheap-first check on the prefix so we
 * don't `JSON.parse` every markdown comment.
 */
function tryParseTipTapJson(value: string): TipTapDoc | null {
  const trimmed = value.trimStart();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isTipTapDoc(parsed) ? parsed : null;
  } catch {
    return null;
  }
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

  // String content — TipTap-JSON / markdown / HTML
  if (typeof content === 'string') {
    if (!content.trim()) return null;
    // Comments composer persists TipTap state as `JSON.stringify
    // (editor.getJSON())`, so string-typed content may actually
    // be a serialised TipTap doc. Try the JSON path first;
    // markdown is the fallback for plain text.
    const docFromJson = tryParseTipTapJson(content);
    if (docFromJson) {
      return <TipTapRenderer content={docFromJson} className={className} sx={sx} compact={compact} />;
    }
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
