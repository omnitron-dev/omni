/** Lossless source envelope. Only edited blocks are serialised; unknown blocks stay inert source.
 * Session block IDs are not edition IDs or persisted citation anchors. */
import { fromMarkdown } from 'mdast-util-from-markdown';
import { toMarkdown } from 'mdast-util-to-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown, gfmToMarkdown } from 'mdast-util-gfm';
import { math } from 'micromark-extension-math';
import { mathFromMarkdown, mathToMarkdown } from 'mdast-util-math';
import { directive } from 'micromark-extension-directive';
import { directiveFromMarkdown } from 'mdast-util-directive';
import type { JSONContent } from '@tiptap/core';
import type { Node as ProseNode } from '@tiptap/pm/model';
import { parseResearchMarkdown, researchLimits } from '../research/parse.js';

type Ast = {
  type: string;
  children?: Ast[];
  position?: { start: { offset: number }; end: { offset: number } };
  [key: string]: unknown;
};
const opaque = new Set([
  'html',
  'image',
  'imageReference',
  'linkReference',
  'definition',
  'footnoteDefinition',
  'footnoteReference',
  'containerDirective',
  'leafDirective',
  'textDirective',
  'math',
]);
const hasOpaque = (n: Ast): boolean =>
  (n.type === 'code' && !!n.meta) ||
  (n.type === 'list' &&
    n.children?.some((c) => typeof c.checked === 'boolean') &&
    !n.children?.every((c) => typeof c.checked === 'boolean')) ||
  (n.type === 'table' && Array.isArray(n.align) && n.align.some(Boolean)) ||
  opaque.has(n.type) ||
  (n.type === 'code' && ['mermaid', 'pintora', 'prism'].includes(String(n.lang).toLowerCase())) ||
  !!n.children?.some(hasOpaque);
export const newBlockId = () => crypto.randomUUID();
function semantic(n: JSONContent): unknown {
  const attrs = Object.fromEntries(
    Object.entries(n.attrs ?? {}).filter(([k, v]) => !['source', 'id'].includes(k) && v != null)
  );
  return {
    type: n.type,
    ...(Object.keys(attrs).length ? { attrs } : {}),
    ...(n.text !== undefined ? { text: n.text } : {}),
    ...(n.marks?.length ? { marks: n.marks } : {}),
    ...(n.content?.length ? { content: n.content.map(semantic) } : {}),
  };
}
export const signature = (content: JSONContent[]) => JSON.stringify(content.map(semantic));
export function sourceDocument(source: string, id: () => string = newBlockId): JSONContent {
  if (source.length > researchLimits.source) throw new Error('document_limit');
  // The reader's structural limits apply before constructing an editable projection.
  parseResearchMarkdown(source);
  const ast = fromMarkdown(source, {
    extensions: [gfm(), math(), directive()],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown(), directiveFromMarkdown()],
  }) as unknown as Ast;
  let end = 0;
  const content = (ast.children ?? []).map((n) => {
    const start = n.position!.start.offset,
      stop = n.position!.end.offset;
    const raw = source.slice(start, stop),
      prefix = source.slice(end, start);
    end = stop;
    const nodes: JSONContent[] = hasOpaque(n)
      ? [{ type: 'researchSource', attrs: { raw, kind: n.type === 'code' ? String(n.lang) : n.type } }]
      : (parseResearchMarkdown(raw).doc.content as JSONContent[]);
    const cleaned = nodes.map(cleanNode);
    return {
      type: 'researchBlock',
      attrs: { id: id(), raw, prefix, baseline: signature(cleaned) },
      content: cleaned.length ? cleaned : [{ type: 'paragraph' }],
    };
  });
  return {
    type: 'doc',
    attrs: { tail: source.slice(end) },
    content: content.length
      ? content
      : [
          {
            type: 'researchBlock',
            attrs: { id: id(), raw: '', prefix: '', baseline: signature([{ type: 'paragraph' }]) },
            content: [{ type: 'paragraph' }],
          },
        ],
  };
}
function cleanNode(n: JSONContent): JSONContent {
  const attrs = Object.fromEntries(Object.entries(n.attrs ?? {}).filter(([k]) => !['source', 'id'].includes(k)));
  // ProseMirror defaults must be explicit in the baseline, or opening a document appears to edit it.
  if (n.type === 'orderedList') attrs.start ??= 1;
  if (n.type === 'codeBlock') attrs.language ||= null;
  if (n.type === 'taskItem') attrs.checked ??= false;
  return { ...n, attrs, content: n.content?.map(cleanNode) };
}
function astNode(n: JSONContent): Ast {
  const children = () => (n.content ?? []).map(astNode),
    a = n.attrs ?? {};
  let result: Ast;
  switch (n.type) {
    case 'paragraph':
      result = { type: 'paragraph', children: children() };
      break;
    case 'heading':
      result = { type: 'heading', depth: a.level, children: children() };
      break;
    case 'text':
      result = { type: 'text', value: n.text ?? '' };
      break;
    case 'hardBreak':
      return { type: 'break' };
    case 'horizontalRule':
      return { type: 'thematicBreak' };
    case 'blockquote':
      return { type: 'blockquote', children: children() };
    case 'codeBlock':
      return { type: 'code', lang: a.language || null, value: (n.content ?? []).map((x) => x.text ?? '').join('') };
    case 'mathInline':
      result = { type: 'inlineMath', value: a.tex ?? '' };
      break;
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return {
        type: 'list',
        ordered: n.type === 'orderedList',
        start: a.start ?? 1,
        spread: false,
        children: children(),
      };
    case 'listItem':
    case 'taskItem':
      return {
        type: 'listItem',
        spread: false,
        checked: n.type === 'taskItem' ? !!a.checked : null,
        children: children(),
      };
    case 'table':
      return { type: 'table', align: (n.content?.[0]?.content ?? []).map(() => null), children: children() };
    case 'tableRow':
      return { type: 'tableRow', children: children() };
    case 'tableCell':
    case 'tableHeader':
      if (
        (a.colspan ?? 1) !== 1 ||
        (a.rowspan ?? 1) !== 1 ||
        n.content?.length !== 1 ||
        n.content[0]?.type !== 'paragraph'
      )
        throw Error('unsupported_table_shape');
      return { type: 'tableCell', children: (n.content ?? []).flatMap((p) => (p.content ?? []).map(astNode)) };
    default:
      throw new Error(`unsupported_editor_node:${n.type}`);
  }
  for (const mark of n.marks ?? []) {
    const type = { bold: 'strong', italic: 'emphasis', strike: 'delete', code: 'inlineCode', link: 'link' }[mark.type];
    if (!type) throw new Error(`unsupported_editor_mark:${mark.type}`);
    if (type === 'inlineCode') result = { type, value: n.text ?? '' };
    else
      result = {
        type,
        ...(type === 'link' ? { url: mark.attrs?.href, title: mark.attrs?.title ?? null } : {}),
        children: [result],
      };
  }
  return result;
}
export function blockSource(block: JSONContent): string {
  const content = block.content ?? [];
  if (signature(content) === block.attrs?.baseline) return String(block.attrs.raw ?? '');
  if (content.length === 1 && content[0]?.type === 'researchSource') return String(content[0].attrs?.raw ?? '');
  return toMarkdown({ type: 'root', children: content.map(astNode) } as Parameters<typeof toMarkdown>[0], {
    extensions: [gfmToMarkdown(), mathToMarkdown()],
    bullet: '-',
    fences: true,
  }).replace(/\n$/, '');
}
const blockCache = new WeakMap<ProseNode, string>();
export function editorSource(doc: ProseNode): string {
  const parts: string[] = [];
  doc.forEach((block, _offset, index) => {
    let raw = blockCache.get(block);
    if (raw === undefined) {
      raw = blockSource(block.toJSON());
      blockCache.set(block, raw);
    }
    const prefix = String(block.attrs.prefix ?? '');
    parts.push(index === 0 ? prefix : /\r?\n[ \t]*\r?\n/.test(prefix) ? prefix : '\n\n', raw);
  });
  return parts.join('') + String(doc.attrs.tail ?? '');
}
export interface ResearchSnapshot {
  readonly format: 'prism-research-source/1';
  readonly blocks: number;
  /** Synchronous, cached serialization of this immutable transaction snapshot. */
  getSource(): string;
}
export function snapshot(doc: ProseNode): ResearchSnapshot {
  let source: string | undefined;
  return Object.freeze({
    format: 'prism-research-source/1' as const,
    blocks: doc.childCount,
    getSource: () => (source ??= editorSource(doc)),
  });
}
/** Canonicalise baseline against the actual schema's default attributes without changing source. */
export function hydrateSource(source: string, schema: { nodeFromJSON: (j: JSONContent) => ProseNode }): JSONContent {
  const doc = sourceDocument(source);
  for (const block of doc.content ?? [])
    block.attrs!.baseline = signature(schema.nodeFromJSON(block).toJSON().content ?? []);
  schema.nodeFromJSON(doc).check();
  return doc;
}
