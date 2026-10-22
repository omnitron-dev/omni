import { Node, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { TableKit } from '@tiptap/extension-table';
import { Plugin, NodeSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { MathNodeView, mathEntryKey } from './math-node.js';
import { canSplit } from '@tiptap/pm/transform';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ResearchDocument, type ResearchWidgets, type ResearchLabels } from '../research/document.js';
import { newBlockId, snapshot } from './source.js';
import { runBlockAction } from './block-commands.js';

export const ResearchViewContext = createContext<
  { widgets: ResearchWidgets; labels?: Partial<ResearchLabels> } | undefined
>(undefined);
function SourceView({ node, extension }: NodeViewProps) {
  const presentation = useContext(ResearchViewContext);
  const ref = useRef<HTMLDivElement>(null),
    [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
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
        'Mod-Alt-ArrowUp': () => runBlockAction(this.editor, 'up'),
        'Mod-Alt-ArrowDown': () => runBlockAction(this.editor, 'down'),
        Enter: () => {
          if (!this.editor.isEditable) return false;
          const { state, view } = this.editor,
            { $from, $to } = state.selection;
          if (!$from.sameParent($to) || $from.depth !== 2 || !['paragraph', 'heading'].includes($from.parent.type.name))
            return false;
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
  const mathNode = (name: 'mathInline' | 'mathBlock') =>
    Node.create({
      name,
      marks: name === 'mathInline' ? 'bold italic strike link' : '',
      group: name === 'mathInline' ? 'inline' : 'block',
      inline: name === 'mathInline',
      atom: true,
      selectable: true,
      addAttributes: () => ({ tex: { default: '' } }),
      parseHTML: () => [
        {
          tag: name === 'mathInline' ? 'span[data-math-inline]' : 'div[data-math-block]',
          getAttrs: (element) => ({ tex: element.getAttribute('data-tex') ?? element.textContent ?? '' }),
        },
      ],
      renderHTML: ({ node }) => [
        name === 'mathInline' ? 'span' : 'div',
        {
          [name === 'mathInline' ? 'data-math-inline' : 'data-math-block']: true,
          'data-tex': String(node.attrs.tex),
        },
        String(node.attrs.tex),
      ],
      addNodeView: () =>
        ReactNodeViewRenderer(MathNodeView, {
          // Shadow-DOM math input is not a native INPUT/TEXTAREA. Letting its keys
          // reach ProseMirror would replace the selected atom with ordinary text.
          stopEvent: ({ event }) => event.target instanceof Element && !!event.target.closest('.prism-math-input'),
        }),
      addKeyboardShortcuts() {
        const enter = (backward: boolean) => {
          if (!this.editor.isEditable || !this.editor.state.selection.empty) return false;
          const { $from } = this.editor.state.selection;
          const next = backward ? $from.nodeBefore : $from.nodeAfter;
          if (next?.type.name !== 'mathInline') return false;
          const pos = backward ? $from.pos - next.nodeSize : $from.pos;
          this.editor.view.dispatch(
            this.editor.state.tr
              .setSelection(NodeSelection.create(this.editor.state.doc, pos))
              .setMeta('prismMathEntry', backward ? 'end' : 'start')
          );
          return true;
        };
        return { ArrowLeft: () => enter(true), ArrowRight: () => enter(false) };
      },
    });
  const Ids = Extension.create({
    name: 'researchIds',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: mathEntryKey,
          state: { init: () => 'end' as const, apply: (tr, value) => tr.getMeta('prismMathEntry') ?? value },
        }),
        new Plugin({
          props: {
            decorations(state) {
              const { from, to, empty } = state.selection;
              const decorations: Decoration[] = [];
              state.doc.forEach((node, pos) => {
                if (empty ? from >= pos && from < pos + node.nodeSize : from < pos + node.nodeSize && to > pos)
                  decorations.push(
                    Decoration.node(pos, pos + node.nodeSize, { class: empty ? 'is-current' : 'is-selected' })
                  );
              });
              return DecorationSet.create(state.doc, decorations);
            },
          },
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
    mathNode('mathInline'),
    mathNode('mathBlock'),
    Ids,
  ];
}
