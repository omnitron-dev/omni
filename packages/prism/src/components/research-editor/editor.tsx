'use client';

import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { getSchema, type JSONContent } from '@tiptap/core';
import { useEditor, EditorContent, useEditorState } from '@tiptap/react';
import { TextSelection, NodeSelection } from '@tiptap/pm/state';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Autocomplete, { createFilterOptions } from '@mui/material/Autocomplete';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ResearchWidgets, ResearchLabels } from '../research/document.js';
import { researchLimits } from '../research/parse.js';
import { researchExtensions, ResearchViewContext } from './extensions.js';
import { blockSource, hydrateSource, snapshot, type ResearchSnapshot } from './source.js';
import { currentBlock, findBlock, runBlockAction } from './block-commands.js';
import { BlockControls } from './block-controls.js';
import { ResearchMathContext, type ResearchMathOptions } from './math-node.js';
import './editor.css';

export const defaultResearchEditorLabels = {
  editor: 'Research document',
  insert: 'Insert block',
  search: 'Find a block',
  source: 'Document source',
  editBlock: 'Block source',
  up: 'Move block up',
  down: 'Move block down',
  duplicate: 'Duplicate block',
  remove: 'Delete block',
  undo: 'Undo',
  redo: 'Redo',
  bold: 'Bold',
  italic: 'Italic',
  link: 'Link',
  inlineMath: 'Inline equation',
  apply: 'Apply',
  cancel: 'Cancel',
  invalid: 'This source cannot be applied. Check the document limits and structure.',
  limit: 'Document exceeds the configured source limit.',
  hint: 'Type / for a new block. Ctrl/⌘ + Shift + M inserts an equation. Arrow keys move between text and math.',
  paragraph: 'Text',
  heading: 'Heading',
  list: 'Bullet list',
  ordered: 'Numbered list',
  tasks: 'Task list',
  quote: 'Quote',
  code: 'Code',
  equation: 'Equation',
  diagram: 'Diagram',
  table: 'Table',
  widget: 'Interactive block',
  blocks: 'blocks',
  blockMenu: 'Block actions',
  dragBlock: 'Drag to move; click for block actions. Keyboard: Ctrl/Command + Alt + Up/Down.',
};
export type ResearchEditorLabels = typeof defaultResearchEditorLabels;
export interface ResearchInsertion {
  id: string;
  label: string;
  source: string;
  keywords?: string[];
}
export interface ResearchEditorHandle {
  getSnapshot(): ResearchSnapshot;
  focus(): void;
}
export interface ResearchEditorProps {
  /** Initial source; replace the React key to load another edition or explicitly reconcile a draft. */
  initialSource: string;
  onChange?: (snapshot: ResearchSnapshot) => void;
  ref?: Ref<ResearchEditorHandle>;
  readOnly?: boolean;
  labels?: Partial<ResearchEditorLabels>;
  widgets?: ResearchWidgets;
  /** Localised labels for scientific block previews. */
  previewLabels?: Partial<ResearchLabels>;
  /** Extra insertion recipes, not executable code from the document. */
  insertions?: readonly ResearchInsertion[];
  maxSourceLength?: number;
  /** Contextual block controls; keyboard commands remain available when hidden. */
  blockControls?: boolean;
  /** In-place equation input configuration and localisation. */
  math?: ResearchMathOptions;
  className?: string;
  sx?: SxProps<Theme>;
}
const filterInsertions = createFilterOptions<ResearchInsertion>({
  stringify: (recipe) => [recipe.label, ...(recipe.keywords ?? [])].join(' '),
});
const noWidgets: ResearchWidgets = Object.freeze({});
const noInsertions: readonly ResearchInsertion[] = [];
export function ResearchEditor({
  initialSource,
  onChange,
  ref,
  readOnly = false,
  labels: overrides,
  widgets = noWidgets,
  previewLabels,
  insertions = noInsertions,
  maxSourceLength = researchLimits.source,
  blockControls = true,
  math,
  className,
  sx,
}: ResearchEditorProps) {
  const presentation = useMemo(() => ({ widgets, labels: previewLabels }), [widgets, previewLabels]);
  const labels = useMemo(() => ({ ...defaultResearchEditorLabels, ...overrides }), [overrides]);
  const workspace = useRef<HTMLDivElement>(null);
  const notify = useRef(onChange);
  notify.current = onChange;
  const [palette, setPalette] = useState(false),
    [dialog, setDialog] = useState<{ kind: 'document' | 'block' | 'link'; text: string; pos?: number }>(),
    [invalid, setInvalid] = useState('');
  const extensions = useMemo(
    () =>
      researchExtensions(widgets, { source: maxSourceLength, onLimit: () => setInvalid(labels.limit) }, previewLabels),
    [widgets, maxSourceLength, labels.limit, previewLabels]
  );
  const [initial] = useState(() => hydrateSource(initialSource, getSchema(extensions)));
  const editor = useEditor({
    extensions,
    content: initial,
    editable: !readOnly,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': labels.editor },
      handleKeyDown: (view, event) => {
        if (
          !readOnly &&
          !event.isComposing &&
          (event.metaKey || event.ctrlKey) &&
          event.shiftKey &&
          event.key.toLowerCase() === 'm'
        ) {
          event.preventDefault();
          insertInlineMath();
          return true;
        }
        if (
          event.key === '/' &&
          !event.isComposing &&
          !view.composing &&
          view.state.selection.empty &&
          view.state.selection.$from.parent.type.name === 'paragraph' &&
          view.state.selection.$from.parent.content.size === 0
        ) {
          event.preventDefault();
          setPalette(true);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => {
      setInvalid('');
      notify.current?.(snapshot(e.state.doc));
    },
  });
  useImperativeHandle(
    ref,
    () => ({
      getSnapshot: () =>
        editor
          ? snapshot(editor.state.doc)
          : { format: 'prism-research-source/1', blocks: initial.content?.length ?? 0, getSource: () => initialSource },
      focus: () => {
        editor?.commands.focus();
      },
    }),
    [editor, initial, initialSource]
  );
  // Changing editable must also stop the contenteditable surface; a disabled fieldset alone does not.
  useEffect(() => {
    editor?.setEditable(!readOnly, false);
    if (readOnly) {
      setPalette(false);
      setDialog(undefined);
    }
  }, [editor, readOnly]);
  const selection = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive('bold'),
            italic: e.isActive('italic'),
            index: currentBlock(e)?.index ?? 0,
            blocks: e.state.doc.childCount,
            undo: e.can().undo(),
            redo: e.can().redo(),
          }
        : null,
  });
  const blockIndex = selection?.index ?? (editor ? currentBlock(editor)?.index : undefined) ?? 0;
  const blockCount = selection?.blocks ?? editor?.state.doc.childCount ?? initial.content?.length ?? 1;
  const recipes = useMemo<ResearchInsertion[]>(
    () => [
      { id: 'text', label: labels.paragraph, source: '' },
      { id: 'heading', label: labels.heading, source: '## ' },
      { id: 'list', label: labels.list, source: '- ' },
      { id: 'ordered', label: labels.ordered, source: '1. ' },
      { id: 'tasks', label: labels.tasks, source: '- [ ] ' },
      { id: 'quote', label: labels.quote, source: '> ' },
      { id: 'code', label: labels.code, source: '```\n\n```' },
      { id: 'equation', label: labels.equation, source: '$$\n\\placeholder{}\n$$' },
      { id: 'diagram', label: labels.diagram, source: '```mermaid\nflowchart LR\n  A[Source] --> B[Question]\n```' },
      { id: 'table', label: labels.table, source: '| A | B |\n| --- | --- |\n|  |  |' },
      ...insertions,
    ],
    [labels, insertions]
  );
  function insertInlineMath() {
    if (!editor?.isEditable) return;
    if (editor.state.selection instanceof NodeSelection && editor.state.selection.node.type.name === 'mathInline')
      return;
    const tr = editor.state.tr.replaceSelectionWith(editor.schema.nodes.mathInline!.create({ tex: '\\placeholder{}' }));
    tr.setSelection(NodeSelection.create(tr.doc, tr.selection.from - 1));
    editor.view.dispatch(tr.setMeta('prismMathEntry', 'start'));
  }
  function applyDocument(source: string) {
    if (!editor) return;
    if (source.length > maxSourceLength) throw Error('document_limit');
    const json = hydrateSource(source, editor.schema),
      doc = editor.schema.nodeFromJSON(json);
    editor.view.dispatch(
      editor.state.tr
        .replaceWith(0, editor.state.doc.content.size, doc.content)
        .setDocAttribute('tail', doc.attrs.tail)
        .scrollIntoView()
    );
  }
  function insert(recipe: ResearchInsertion) {
    if (!editor?.isEditable) return;
    const selected = currentBlock(editor),
      old = selected && editor.state.doc.child(selected.index);
    const blocks = hydrateSource(recipe.source, editor.schema).content ?? [];
    // Empty Markdown markers are parsed deliberately by recipe, not mistaken for literal prose.
    const simple: Record<string, JSONContent> = {
      heading: { type: 'heading', attrs: { level: 2 } },
      list: { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
      ordered: { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
      tasks: {
        type: 'taskList',
        content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph' }] }],
      },
      quote: { type: 'blockquote', content: [{ type: 'paragraph' }] },
    };
    if (simple[recipe.id] && blocks[0]) {
      blocks[0].content = [simple[recipe.id]!];
      blocks[0].attrs!.baseline = '';
    }
    const empty =
      old?.childCount === 1 && old.firstChild?.type.name === 'paragraph' && old.firstChild.content.size === 0;
    const from = selected ? selected.pos + (empty ? 0 : old!.nodeSize) : editor.state.doc.content.size;
    const to = empty ? from + old!.nodeSize : from;
    const tr = editor.state.tr.replaceWith(
      from,
      to,
      blocks.map((b) => editor.schema.nodeFromJSON(b))
    );
    const first = tr.doc.nodeAt(from)?.firstChild;
    tr.setSelection(
      first?.isAtom && !first.isTextblock
        ? NodeSelection.create(tr.doc, from + 1)
        : TextSelection.near(tr.doc.resolve(Math.min(from + 2, tr.doc.content.size)))
    );
    editor.view.dispatch(tr.scrollIntoView());
    setPalette(false);
    editor.commands.focus();
  }
  function openSource(id?: string) {
    if (!editor?.isEditable) return;
    const block = id ? findBlock(editor.state.doc, id) : currentBlock(editor);
    if (!block) return;
    setDialog({ kind: 'block', pos: block.pos, text: blockSource(editor.state.doc.child(block.index).toJSON()) });
  }
  function applyDialog(text: string) {
    if (!editor?.isEditable || !dialog) return;
    try {
      if (dialog.kind === 'document') applyDocument(text);
      else if (dialog.kind === 'block') {
        const old = editor.state.doc.nodeAt(dialog.pos!);
        if (!old) throw Error('stale_selection');
        const blocks = hydrateSource(text, editor.schema).content!;
        blocks[0]!.attrs = { ...blocks[0]!.attrs, id: old.attrs.id, prefix: old.attrs.prefix };
        const tr = editor.state.tr.replaceWith(
          dialog.pos!,
          dialog.pos! + old.nodeSize,
          blocks.map((b) => editor.schema.nodeFromJSON(b))
        );
        if (snapshot(tr.doc).getSource().length > maxSourceLength) throw Error('document_limit');
        editor.view.dispatch(tr.scrollIntoView());
      } else {
        if (text && !/^(https?:\/\/|mailto:)/i.test(text)) throw Error('invalid_link');
        const chain = editor.chain().focus().extendMarkRange('link');
        if (text) chain.setLink({ href: text }).run();
        else chain.unsetLink().run();
      }
      setDialog(undefined);
      setInvalid('');
      editor.commands.focus();
    } catch {
      setInvalid(labels.invalid);
    }
  }
  const button = (label: string, action: () => void, disabled = false, pressed?: boolean) => (
    <Button
      size="small"
      variant={pressed ? 'contained' : 'text'}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={readOnly || !editor || disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => action()}
    >
      {label}
    </Button>
  );
  return (
    <Box
      className={['prism-science', className].filter(Boolean).join(' ')}
      sx={[
        (theme) => ({
          '--prism-editor-border': theme.palette.divider,
          '--prism-editor-bg': theme.palette.background.paper,
          '--prism-editor-muted': theme.palette.text.secondary,
          '--prism-editor-accent': theme.palette.primary.main,
          '--prism-editor-radius': `${theme.shape.borderRadius}px`,
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <div className="prism-science__toolbar" role="toolbar" aria-label={labels.editor}>
        {button('+ ' + labels.insert, () => setPalette(true))}
        {button(
          labels.bold,
          () => {
            editor?.chain().focus().toggleBold().run();
          },
          false,
          selection?.bold
        )}
        {button(
          labels.italic,
          () => {
            editor?.chain().focus().toggleItalic().run();
          },
          false,
          selection?.italic
        )}
        {button(labels.link, () => setDialog({ kind: 'link', text: String(editor?.getAttributes('link').href ?? '') }))}
        {button(labels.inlineMath, insertInlineMath)}
        {button(
          labels.undo,
          () => {
            editor?.chain().focus().undo().run();
          },
          !selection?.undo
        )}
        {button(
          labels.redo,
          () => {
            editor?.chain().focus().redo().run();
          },
          !selection?.redo
        )}
        {button(labels.source, () => {
          if (editor) setDialog({ kind: 'document', text: snapshot(editor.state.doc).getSource() });
        })}
      </div>
      <p className="prism-science__hint">{labels.hint}</p>
      {invalid && !dialog && <p role="alert">{invalid}</p>}
      <div
        ref={workspace}
        className={`prism-science__workspace${blockControls ? ' prism-science__workspace--controls' : ''}`}
      >
        <ResearchViewContext.Provider value={presentation}>
          <ResearchMathContext.Provider value={{ ...math, readOnly }}>
            <EditorContent editor={editor} className="prism-science__content" />
          </ResearchMathContext.Provider>
        </ResearchViewContext.Provider>
        {editor && blockControls && (
          <BlockControls
            editor={editor}
            container={workspace}
            labels={labels}
            readOnly={readOnly}
            onSource={openSource}
            onInsert={(id) => {
              if (!editor.isEditable) return;
              const block = findBlock(editor.state.doc, id);
              if (block) {
                editor.commands.setNodeSelection(block.pos);
                setPalette(true);
              }
            }}
          />
        )}
      </div>
      <div className="prism-science__block-tools" role="group" aria-label={labels.editBlock}>
        <span aria-live="polite" aria-atomic="true">
          {blockIndex + 1} / {blockCount} {labels.blocks}
        </span>
        {button(labels.editBlock, openSource)}
        {button(
          labels.up,
          () => {
            if (editor) runBlockAction(editor, 'up');
          },
          blockIndex === 0
        )}
        {button(
          labels.down,
          () => {
            if (editor) runBlockAction(editor, 'down');
          },
          blockIndex === blockCount - 1
        )}
        {button(labels.duplicate, () => {
          if (editor) runBlockAction(editor, 'duplicate');
        })}
        {button(labels.remove, () => {
          if (editor) runBlockAction(editor, 'remove');
        })}
      </div>
      <Dialog open={palette} onClose={() => setPalette(false)} fullWidth maxWidth="sm">
        <DialogTitle>{labels.insert}</DialogTitle>
        <DialogContent>
          <Autocomplete
            value={null}
            openText={labels.insert}
            closeText={labels.cancel}
            options={recipes}
            filterOptions={filterInsertions}
            getOptionLabel={(r) => r.label}
            onChange={(_e, value) => {
              if (value) insert(value);
            }}
            renderInput={(params) => <TextField {...params} autoFocus label={labels.search} margin="dense" />}
            openOnFocus
            disablePortal
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPalette(false)}>{labels.cancel}</Button>
        </DialogActions>
      </Dialog>
      {dialog && (
        <SourceDialog
          key={`${dialog.kind}:${dialog.pos}`}
          title={dialog.kind === 'document' ? labels.source : dialog.kind === 'link' ? labels.link : labels.editBlock}
          initial={dialog.text}
          maxLength={maxSourceLength}
          labels={labels}
          error={invalid}
          onCancel={() => {
            setDialog(undefined);
            setInvalid('');
          }}
          onApply={applyDialog}
        />
      )}
    </Box>
  );
}
function SourceDialog({
  title,
  initial,
  maxLength,
  labels,
  error,
  onCancel,
  onApply,
}: {
  title: string;
  initial: string;
  maxLength: number;
  labels: ResearchEditorLabels;
  error: string;
  onCancel: () => void;
  onApply: (value: string) => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <Dialog open onClose={onCancel} fullWidth maxWidth="md">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <TextField
          label={title}
          value={text}
          onChange={(e) => setText(e.target.value)}
          multiline
          minRows={5}
          maxRows={20}
          fullWidth
          autoFocus
          margin="dense"
          slotProps={{ htmlInput: { maxLength, spellCheck: false } }}
        />
        {error && <p role="alert">{error}</p>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{labels.cancel}</Button>
        <Button onClick={() => onApply(text)} variant="contained">
          {labels.apply}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
