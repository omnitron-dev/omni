/**
 * Content utilities - Parse and serialize editor content
 *
 * Handles conversion between different content formats:
 * - HTML
 * - JSON
 * - Plain text
 * - Markdown (basic support)
 */

import type { Schema, Node as PMNode } from 'prosemirror-model';
import { DOMParser, DOMSerializer } from 'prosemirror-model';
import type { JSONContent, ContentType, ParseOptions, SerializeOptions } from '../core/types.js';

/**
 * Parse content into a ProseMirror document
 */
export function parseContent(
  content: string | JSONContent | undefined,
  schema: Schema,
  type?: ContentType,
  options?: ParseOptions
): PMNode {
  // Default to empty document
  if (!content || (typeof content === 'string' && content.trim().length === 0)) {
    return schema.node('doc', null, [schema.node('paragraph')]);
  }

  // Auto-detect content type if not provided
  let contentType = type;
  if (!contentType && typeof content === 'string') {
    // Check if content looks like HTML (contains HTML tags)
    if (/<[a-z][\s\S]*>/i.test(content.trim())) {
      contentType = 'html';
    } else {
      contentType = 'text';
    }
  } else if (!contentType && typeof content === 'object') {
    contentType = 'json';
  } else if (!contentType) {
    contentType = 'text';
  }

  switch (contentType) {
    case 'json':
      return parseJSON(content as JSONContent, schema);

    case 'html':
      return parseHTML(content as string, schema, options);

    case 'markdown':
      // For Phase 1, just treat markdown as plain text
      // Phase 4 will add proper markdown parsing
      return parseText(content as string, schema);

    case 'text':
    default:
      return parseText(content as string, schema);
  }
}

/**
 * Parse JSON content
 */
export function parseJSON(content: JSONContent, schema: Schema): PMNode {
  try {
    return schema.nodeFromJSON(content);
  } catch (error) {
    console.error('Failed to parse JSON content:', error);
    // Return empty document on error
    return schema.node('doc', null, [schema.node('paragraph')]);
  }
}

/**
 * Parse HTML content
 */
export function parseHTML(html: string, schema: Schema, options?: ParseOptions): PMNode {
  // Create a temporary DOM element
  const div = document.createElement('div');
  div.innerHTML = html;

  try {
    const parser = DOMParser.fromSchema(schema);
    return parser.parse(div, options);
  } catch (error) {
    console.error('Failed to parse HTML content:', error);
    // Return empty document on error
    return schema.node('doc', null, [schema.node('paragraph')]);
  }
}

/**
 * Parse plain text content
 */
export function parseText(text: string, schema: Schema): PMNode {
  // Split text into paragraphs by newlines
  const lines = text.split('\n').filter((line) => line.length > 0);

  if (lines.length === 0) {
    return schema.node('doc', null, [schema.node('paragraph')]);
  }

  const paragraphs = lines.map((line) => schema.node('paragraph', null, line.length > 0 ? [schema.text(line)] : []));

  return schema.node('doc', null, paragraphs);
}

/**
 * Serialize document to HTML
 */
export function serializeHTML(doc: PMNode, options?: SerializeOptions): string {
  const serializer = DOMSerializer.fromSchema(doc.type.schema);
  const fragment = serializer.serializeFragment(doc.content);

  // Create a container
  const div = document.createElement('div');
  div.appendChild(fragment);

  let html = div.innerHTML;

  // Pretty print if requested
  if (options?.pretty) {
    html = prettifyHTML(html);
  }

  return html;
}

/**
 * Serialize document to JSON
 */
export function serializeJSON(doc: PMNode): JSONContent {
  return doc.toJSON() as JSONContent;
}

/**
 * Serialize document to plain text
 */
export function serializeText(doc: PMNode): string {
  return doc.textContent;
}

/**
 * Serialize document based on content type
 */
export function serializeContent(
  doc: PMNode,
  type: ContentType = 'html',
  options?: SerializeOptions
): string | JSONContent {
  switch (type) {
    case 'json':
      return serializeJSON(doc);

    case 'html':
      return serializeHTML(doc, options);

    case 'markdown':
      // For Phase 1, just return text
      // Phase 4 will add proper markdown serialization
      return serializeText(doc);

    case 'text':
    default:
      return serializeText(doc);
  }
}

/**
 * Basic HTML prettifier
 */
function prettifyHTML(html: string): string {
  // Simple indentation (not perfect but good enough)
  let indentLevel = 0;
  const indent = '  ';

  return html
    .split(/(<[^>]+>)/)
    .filter((part) => part.trim().length > 0)
    .map((part) => {
      if (part.startsWith('</')) {
        indentLevel--;
        return indent.repeat(Math.max(0, indentLevel)) + part;
      } else if (part.startsWith('<') && !part.endsWith('/>')) {
        const result = indent.repeat(indentLevel) + part;
        indentLevel++;
        return result;
      } else if (part.startsWith('<')) {
        return indent.repeat(indentLevel) + part;
      } else {
        return indent.repeat(indentLevel) + part.trim();
      }
    })
    .join('\n');
}

/**
 * Create an empty document
 */
export function createEmptyDoc(schema: Schema): PMNode {
  return schema.node('doc', null, [schema.node('paragraph')]);
}
