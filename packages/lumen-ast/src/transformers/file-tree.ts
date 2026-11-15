import type { Element, ElementContent } from 'hast';
import type { LumenNode } from '../ast/types.js';
import { element, text } from './html-tree.js';

interface FileTreeEntry {
  name: LumenNode;
  annotation: LumenNode[];
  directory: boolean;
  children: FileTreeEntry[];
}

/** One interpretation of the already-parsed Markdown list, shared by document emitters. */
export function readFileTree(node: LumenNode): { title: string; entries: FileTreeEntry[] } {
  const title = node.attributes?.['title'];
  if (title !== undefined && typeof title !== 'string') throw new TypeError('filetree title must be a string');
  const readList = (list: LumenNode): FileTreeEntry[] => {
    if (list.type !== 'list' || list.ordered) throw new TypeError('filetree requires an unordered Markdown list');
    return (list.children ?? []).map(item => {
      const [label, nested, ...extra] = item.children ?? [];
      const [name, ...annotation] = label?.children ?? [];
      if (item.type !== 'listItem' || label?.type !== 'paragraph' || name?.type !== 'inlineCode' || !name.value ||
        extra.length || (nested && nested.type !== 'list')) {
        throw new TypeError('Each filetree item must start with an inline-code filename, followed by an optional annotation and nested list');
      }
      return { name, annotation, directory: Boolean(nested) || name.value.endsWith('/'), children: nested ? readList(nested) : [] };
    });
  };
  if (node.children?.length !== 1) throw new TypeError('filetree requires one unordered Markdown list');
  return { title: title ?? 'File tree', entries: readList(node.children[0]!) };
}

function marker(directory: boolean): Element {
  const paths = directory
    ? ['M2 6h5l2 2h13v12H2z', 'M2 6V4h7l2 2h9v2']
    : ['M5 2h9l5 5v15H5z', 'M14 2v6h5'];
  return element('svg', {
    className: ['lumen-file-tree-icon'], viewBox: '0 0 24 24', width: 16, height: 16,
    fill: 'none', stroke: 'currentColor', strokeWidth: '1.5', strokeLineJoin: 'round',
    ariaHidden: 'true', focusable: 'false',
  }, paths.map(d => element('path', { d })));
}

export function renderFileTree(node: LumenNode, renderInline: (nodes: LumenNode[]) => ElementContent[]): Element {
  const { title, entries } = readFileTree(node);
  const list = (items: FileTreeEntry[]): Element => element('ul', {}, items.map(entry => {
    const row = element('span', { className: ['lumen-file-tree-row'] }, [
      marker(entry.directory),
      element('span', { className: ['lumen-file-tree-name'] }, renderInline([entry.name])),
      ...(entry.annotation.length
        ? [element('span', { className: ['lumen-file-tree-description'] }, renderInline(entry.annotation))] : []),
    ]);
    return element('li', {}, entry.children.length
      ? [element('details', { open: true }, [element('summary', {}, [row]), list(entry.children)])] : [row]);
  }));
  return element('figure', { className: ['lumen-file-tree'] }, [element('figcaption', {}, [text(title)]), list(entries)]);
}

export function fileTreeTypstLines(node: LumenNode, renderInline: (nodes: LumenNode[]) => string): string {
  const render = (entries: FileTreeEntry[], depth: number): string => entries.map(entry =>
    `${'  '.repeat(depth)}- ${renderInline([entry.name, ...entry.annotation])}\n${render(entry.children, depth + 1)}`
  ).join('');
  return render(readFileTree(node).entries, 0);
}
