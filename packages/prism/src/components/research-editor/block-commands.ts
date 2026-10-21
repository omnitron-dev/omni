/** Identity-based block operations shared by pointer, keyboard and menu interfaces. */
import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { NodeSelection, Selection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { newBlockId } from './source.js';
import { closeHistory } from '@tiptap/pm/history';
export type ResearchBlockAction = 'up' | 'down' | 'duplicate' | 'remove';
export function findBlock(doc: Node, id: string) {
  let found: { node: Node; pos: number; index: number } | undefined;
  doc.forEach((node, pos, index) => {
    if (node.type.name === 'researchBlock' && node.attrs.id === id) found = { node, pos, index };
  });
  return found;
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
function selectMoved(tr: Transaction, state: EditorState, oldPos: number, newPos: number, node: Node) {
  const { selection } = state;
  const within = selection.from >= oldPos && selection.to <= oldPos + node.nodeSize;
  if (within && selection instanceof TextSelection) {
    tr.setSelection(TextSelection.create(tr.doc, newPos + selection.anchor - oldPos, newPos + selection.head - oldPos));
  } else if (within && selection instanceof NodeSelection) {
    tr.setSelection(NodeSelection.create(tr.doc, newPos + selection.from - oldPos));
  } else {
    tr.setSelection(Selection.near(tr.doc.resolve(newPos + 1)));
  }
  return closeHistory(tr).scrollIntoView();
}
/** Move before a current block identity, or to the end. Missing/stale identities fail closed. */
export function moveBlockTransaction(state: EditorState, id: string, beforeId: string | null): Transaction | undefined {
  const from = findBlock(state.doc, id);
  const before = beforeId === null ? undefined : findBlock(state.doc, beforeId);
  if (!from || (beforeId !== null && !before) || beforeId === id) return undefined;
  const destination = before?.index ?? state.doc.childCount;
  if (destination === from.index + 1 || (destination === state.doc.childCount && from.index === destination - 1))
    return undefined;
  const tr = state.tr.delete(from.pos, from.pos + from.node.nodeSize);
  const target = beforeId === null ? tr.doc.content.size : findBlock(tr.doc, beforeId)!.pos;
  tr.insert(target, from.node);
  return selectMoved(tr, state, from.pos, target, from.node);
}
export function blockActionTransaction(
  state: EditorState,
  id: string,
  action: ResearchBlockAction
): Transaction | undefined {
  const block = findBlock(state.doc, id);
  if (!block) return undefined;
  const { node, pos, index } = block;
  if (action === 'up')
    return index > 0 ? moveBlockTransaction(state, id, String(state.doc.child(index - 1).attrs.id)) : undefined;
  if (action === 'down')
    return index < state.doc.childCount - 1
      ? moveBlockTransaction(
          state,
          id,
          index + 2 < state.doc.childCount ? String(state.doc.child(index + 2).attrs.id) : null
        )
      : undefined;
  const tr = state.tr;
  if (action === 'duplicate') {
    const copy = node.type.create({ ...node.attrs, id: newBlockId(), prefix: '\n\n' }, node.content);
    tr.insert(pos + node.nodeSize, copy);
    return selectMoved(tr, state, pos, pos + node.nodeSize, copy);
  }
  if (state.doc.childCount === 1) {
    tr.replaceWith(
      pos,
      pos + node.nodeSize,
      node.type.create({ id: newBlockId() }, state.schema.nodes.paragraph!.create())
    );
  } else {
    tr.delete(pos, pos + node.nodeSize);
  }
  tr.setSelection(Selection.near(tr.doc.resolve(Math.min(pos + 1, tr.doc.content.size))));
  return closeHistory(tr).scrollIntoView();
}
export function runBlockAction(editor: Editor, action: ResearchBlockAction, id?: string): boolean {
  if (!editor.isEditable) return false;
  const selected = currentBlock(editor);
  const target = id ?? (selected && String(editor.state.doc.child(selected.index).attrs.id));
  const tr = target && blockActionTransaction(editor.state, target, action);
  return dispatchBlockTransaction(editor, tr || undefined);
}
export function dispatchBlockTransaction(editor: Editor, tr: Transaction | undefined): boolean {
  if (!editor.isEditable || !tr) return false;
  editor.view.dispatch(tr);
  // Discrete block edits must not merge with either previous or subsequent typing.
  editor.view.dispatch(closeHistory(editor.state.tr));
  editor.commands.focus();
  return true;
}
