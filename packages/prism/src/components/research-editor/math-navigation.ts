import { NodeSelection, TextSelection, type EditorState } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { newBlockId } from './source.js';

/** Leave an equation at its document boundary, preserving neighbouring structure. */
export function exitMathTransaction(state: EditorState, pos: number, before: boolean) {
  const node = state.doc.nodeAt(pos);
  if (!node || !['mathInline', 'mathBlock'].includes(node.type.name)) return undefined;
  const tr = state.tr;
  let target = TextSelection.near(tr.doc.resolve(before ? pos : pos + node.nodeSize), before ? -1 : 1);
  const neighbourMath =
    target instanceof NodeSelection &&
    ['mathInline', 'mathBlock'].includes(target.node.type.name) &&
    target.from !== pos;
  const reachableText =
    target instanceof TextSelection && (before ? target.from <= pos : target.from >= pos + node.nodeSize);
  if (!neighbourMath && !reachableText) {
    const $pos = tr.doc.resolve(pos);
    const edge = before ? $pos.before(1) : $pos.after(1);
    tr.insert(
      edge,
      state.schema.nodes.researchBlock!.create({ id: newBlockId() }, state.schema.nodes.paragraph!.create())
    );
    target = TextSelection.create(tr.doc, edge + 2);
  }
  return closeHistory(tr.setSelection(target))
    .setMeta('prismMathEntry', before ? 'end' : 'start')
    .scrollIntoView();
}

/** Replace formula source without mapping the selected atom into a text caret. */
export function updateMathTransaction(state: EditorState, pos: number, tex: string) {
  const node = state.doc.nodeAt(pos);
  if (!node || !['mathInline', 'mathBlock'].includes(node.type.name)) return undefined;
  const tr = state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, tex });
  if (state.selection instanceof NodeSelection && state.selection.from === pos)
    tr.setSelection(NodeSelection.create(tr.doc, pos));
  return tr;
}
