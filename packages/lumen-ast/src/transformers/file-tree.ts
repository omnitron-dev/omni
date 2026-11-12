import type { LumenNode } from '../ast/types.js';
import { escapeHtml } from '../katex/render-math.js';

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

function marker(directory: boolean): string {
  const path = directory
    ? '<path d="M2 6h5l2 2h13v12H2z"/><path d="M2 6V4h7l2 2h9v2"/>'
    : '<path d="M5 2h9l5 5v15H5z"/><path d="M14 2v6h5"/>';
  return `<svg class="lumen-file-tree-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true" focusable="false">${path}</svg>`;
}

export function renderFileTreeHtml(node: LumenNode, renderInline: (nodes: LumenNode[]) => string): string {
  const { title, entries } = readFileTree(node);
  const list = (items: FileTreeEntry[]): string => `<ul>${items.map(entry => {
    const row = `<span class="lumen-file-tree-row">${marker(entry.directory)}<span class="lumen-file-tree-name">${renderInline([entry.name])}</span>${entry.annotation.length ? `<span class="lumen-file-tree-description">${renderInline(entry.annotation)}</span>` : ''}</span>`;
    return `<li>${entry.children.length ? `<details open><summary>${row}</summary>${list(entry.children)}</details>` : row}</li>`;
  }).join('')}</ul>`;
  return `<figure class="lumen-file-tree"><figcaption>${escapeHtml(title)}</figcaption>${list(entries)}</figure>`;
}

export function fileTreeTypstLines(node: LumenNode, renderInline: (nodes: LumenNode[]) => string): string {
  const render = (entries: FileTreeEntry[], depth: number): string => entries.map(entry =>
    `${'  '.repeat(depth)}- ${renderInline([entry.name, ...entry.annotation])}\n${render(entry.children, depth + 1)}`
  ).join('');
  return render(readFileTree(node).entries, 0);
}
