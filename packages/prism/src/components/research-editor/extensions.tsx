import { Node, Extension, type Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { TableKit } from '@tiptap/extension-table';
import { Plugin } from '@tiptap/pm/state';
import { canSplit } from '@tiptap/pm/transform';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import katex from 'katex';
import { ResearchDocument, type ResearchWidgets, type ResearchLabels } from '../research/document.js';
import { newBlockId, snapshot } from './source.js';

export const ResearchViewContext = createContext<
  { widgets: ResearchWidgets; labels?: Partial<ResearchLabels> } | undefined
>(undefined);
function SourceView({ node, extension }: NodeViewProps) {
  const presentation = useContext(ResearchViewContext);
  const ref = useRef<HTMLDivElement>(null),
    [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <NodeViewWrapper className="prism-science__source-block" contentEditable={false}>
      <div ref={ref}>
        <span className="prism-science__kind">{String(node.attrs.kind)}</span>
        {visible ? (
          <ResearchDocument
            source={String(node.attrs.raw)}
            widgets={presentation?.widgets ?? extension.options.widgets}
            labels={presentation?.labels ?? extension.options.labels}
          />
        ) : (
          <pre>{String(node.attrs.raw).slice(0, 160)}</pre>
        )}
      </div>
    </NodeViewWrapper>
  );
}
export function currentBlock(editor: Editor): { pos: number; index: number } | undefined {
  const { $from } = editor.state.selection;
  if ($from.depth >= 1) return { pos: $from.before(1), index: $from.index(0) };
  const index = $from.index(0);
  return editor.state.doc.childCount
    ? {
        pos:
          index >= editor.state.doc.childCount
            ? editor.state.doc.content.size - editor.state.doc.lastChild!.nodeSize
            : $from.pos,
        index: Math.min(index, editor.state.doc.childCount - 1),
      }
    : undefined;
}
export function researchExtensions(
  widgets: ResearchWidgets = {},
  limits?: { source: number; onLimit?: () => void },
  labels?: Partial<ResearchLabels>
) {
  const Doc = Node.create({
    name: 'doc',
    topNode: true,
    content: 'researchBlock+',
    addAttributes: () => ({ tail: { default: '' } }),
  });
  const Block = Node.create({
    name: 'researchBlock',
    content: 'block+',
    group: 'researchGroup',
    defining: true,
    draggable: true,
    addAttributes: () => ({
      id: { default: null },
      raw: { default: '' },
      prefix: { default: '' },
      baseline: { default: '' },
    }),
    parseHTML: () => [{ tag: 'div[data-research-block]' }],
    renderHTML: ({ node }) => ['div', { 'data-research-block': node.attrs.id, class: 'prism-science__block' }, 0],
    addKeyboardShortcuts() {
      return {
        Enter: () => {
          const { state, view } = this.editor,
            { $from, $to } = state.selection;
          if (!$from.sameParent($to) || $from.depth !== 2 || !['paragraph', 'heading'].includes($from.parent.type.name))
            return false;
          const pos = $from.pos;
          const next =
            $from.parentOffset === $from.parent.content.size ? state.schema.nodes.paragraph : $from.parent.type;
          const types = [
            { type: state.schema.nodes.researchBlock!, attrs: { id: newBlockId() } },
            { type: next!, attrs: $from.parent.attrs },
          ];
          const tr = state.tr.deleteSelection();
          if (!canSplit(tr.doc, tr.selection.from, 2, types)) return false;
          view.dispatch(tr.split(tr.selection.from, 2, types).scrollIntoView());
          return true;
        },
      };
    },
  });
  const Source = Node.create({
    name: 'researchSource',
    group: 'block',
    atom: true,
    selectable: true,
    addOptions: () => ({ widgets, labels }),
    addAttributes: () => ({ raw: { default: '' }, kind: { default: 'source' } }),
    parseHTML: () => [
      {
        tag: 'pre[data-research-source]',
        priority: 100,
        preserveWhitespace: 'full',
        getAttrs: (element) => ({
          raw: element.getAttribute('data-source') ?? element.textContent ?? '',
          kind: element.getAttribute('data-research-source') ?? 'source',
        }),
      },
    ],
    renderHTML: ({ node }) => [
      'pre',
      { 'data-research-source': node.attrs.kind, 'data-source': node.attrs.raw },
      node.attrs.raw,
    ],
    addNodeView: () => ReactNodeViewRenderer(SourceView),
  });
  const Math = Node.create({
    name: 'mathInline',
    marks: 'bold italic strike link',
    group: 'inline',
    inline: true,
    atom: true,
    addAttributes: () => ({ tex: { default: '' } }),
    parseHTML: () => [
      {
        tag: 'span[data-math-inline]',
        getAttrs: (element) => ({ tex: element.getAttribute('data-tex') ?? element.textContent ?? '' }),
      },
    ],
    renderHTML: ({ node }) => [
      'span',
      { 'data-math-inline': true, 'data-tex': String(node.attrs.tex) },
      String(node.attrs.tex),
    ],
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement('span');
        dom.className = 'prism-science__math';
        dom.contentEditable = 'false';
        dom.title = String(node.attrs.tex);
        try {
          katex.render(String(node.attrs.tex), dom, {
            trust: false,
            strict: 'error',
            throwOnError: true,
            maxExpand: 1000,
            maxSize: 20,
          });
        } catch {
          dom.textContent = String(node.attrs.tex);
        }
        return { dom };
      };
    },
  });
  const Ids = Extension.create({
    name: 'researchIds',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          filterTransaction(tr) {
            if (!tr.docChanged || !limits) return true;
            try {
              if (snapshot(tr.doc).getSource().length <= limits.source) return true;
            } catch {
              /* reject an unserialisable operation */
            }
            limits.onLimit?.();
            return false;
          },
          appendTransaction(transactions, _old, state) {
            if (!transactions.some((t) => t.docChanged)) return null;
            const seen = new Set<string>(),
              tr = state.tr;
            state.doc.forEach((node, pos) => {
              const id = node.attrs.id;
              if (!id || seen.has(id)) tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: newBlockId() });
              else seen.add(id);
            });
            return tr.docChanged ? tr.setMeta('addToHistory', false) : null;
          },
        }),
      ];
    },
  });
  return [
    Doc,
    Block,
    StarterKit.configure({ document: false, underline: false, link: { openOnClick: false }, trailingNode: false }),
    TaskList,
    TaskItem.configure({ nested: true, a11y: { checkboxLabel: (node) => node.textContent } }),
    TableKit.configure({ table: { resizable: false } }),
    Source,
    Math,
    Ids,
  ];
}
