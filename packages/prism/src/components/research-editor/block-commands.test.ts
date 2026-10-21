import { afterEach, describe, expect, it } from 'vitest';
import { Editor, getSchema } from '@tiptap/core';
import { researchExtensions } from './extensions.js';
import { blockSource, editorSource, hydrateSource } from './source.js';
import { blockActionTransaction, findBlock, moveBlockTransaction, runBlockAction } from './block-commands.js';
const editors: Editor[] = [];
const make = (source: string) => {
  const extensions = researchExtensions();
  const e = new Editor({ extensions, content: hydrateSource(source, getSchema(extensions)) });
  editors.push(e);
  return e;
};
const ids = (e: Editor) => e.state.doc.content.content.map((n) => String(n.attrs.id));
afterEach(() => editors.splice(0).forEach((e) => e.destroy()));
describe('identity-based block transactions', () => {
  it('matches every array insertion permutation without changing scientific nodes or their identities', () => {
    const source =
      '# Heading\r\n\r\nFirst 😀 statement.\r\n\r\n$$\n\\int f(x)\\,dx\n$$\n\n```mermaid\ngraph LR\n A-->B\n```\n\n:::future\nRetain exactly.\n:::\n';
    const e = make(source),
      original = e.state.doc;
    const nodes = original.content.content;
    for (let from = 0; from < nodes.length; from++)
      for (let to = 0; to <= nodes.length; to++) {
        const expected = [...nodes];
        if (from !== to && from + 1 !== to) {
          const [node] = expected.splice(from, 1);
          expected.splice(to > from ? to - 1 : to, 0, node!);
        }
        const tr = moveBlockTransaction(
          e.state,
          String(nodes[from]!.attrs.id),
          to === nodes.length ? null : String(nodes[to]!.attrs.id)
        );
        if (tr) e.view.dispatch(tr);
        expect(e.state.doc.content.content).toEqual(expected);
        for (const node of expected)
          expect(blockSource(node.toJSON())).toBe(
            blockSource(nodes.find((n) => n.attrs.id === node.attrs.id)!.toJSON())
          );
        if (tr) {
          e.commands.undo();
          expect(e.state.doc.eq(original)).toBe(true);
          expect(editorSource(e.state.doc)).toBe(source);
        }
      }
  });
  it('preserves the cursor inside the moved paragraph, including astral Unicode', () => {
    const e = make('First.\n\nSecond 😀 statement.\n\nThird.');
    const id = ids(e)[1]!,
      block = findBlock(e.state.doc, id)!;
    e.commands.setTextSelection(block.pos + 2 + 'Second 😀'.length);
    const offset = e.state.selection.$anchor.parentOffset;
    expect(runBlockAction(e, 'up')).toBe(true);
    expect(ids(e)[0]).toBe(id);
    expect(e.state.selection.$anchor.parent.textContent).toBe('Second 😀 statement.');
    expect(e.state.selection.$anchor.parentOffset).toBe(offset);
    e.commands.undo();
    expect(ids(e)[1]).toBe(id);
  });
  it('duplicates an opaque block with a new identity, removes it and restores each transaction', () => {
    const source = '```future\nUninterpreted $data$.\n```';
    const e = make(source),
      initial = ids(e)[0]!;
    expect(runBlockAction(e, 'duplicate', initial)).toBe(true);
    expect(new Set(ids(e)).size).toBe(2);
    const copy = ids(e)[1]!;
    expect(blockSource(e.state.doc.child(1).toJSON())).toBe(source);
    runBlockAction(e, 'remove', copy);
    expect(editorSource(e.state.doc)).toBe(source);
    e.commands.undo();
    expect(ids(e)).toEqual([initial, copy]);
    e.commands.undo();
    expect(ids(e)).toEqual([initial]);
    runBlockAction(e, 'remove', initial);
    expect(editorSource(e.state.doc)).toBe('');
    expect(e.state.doc.childCount).toBe(1);
    e.commands.undo();
    expect(editorSource(e.state.doc)).toBe(source);
  });
  it('rejects stale identities and refuses all block mutations after edit permission is removed', () => {
    const e = make('First.\n\nSecond.'),
      original = e.state.doc;
    expect(moveBlockTransaction(e.state, 'missing', ids(e)[0]!)).toBeUndefined();
    expect(moveBlockTransaction(e.state, ids(e)[0]!, 'missing')).toBeUndefined();
    expect(blockActionTransaction(e.state, 'missing', 'remove')).toBeUndefined();
    e.setEditable(false);
    for (const action of ['up', 'down', 'duplicate', 'remove'] as const)
      expect(runBlockAction(e, action, ids(e)[0])).toBe(false);
    expect(e.state.doc.eq(original)).toBe(true);
  });
});
