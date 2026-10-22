import { afterEach, describe, expect, it } from 'vitest';
import { Editor, getSchema } from '@tiptap/core';
import { DOMParser, DOMSerializer } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { researchExtensions } from './extensions.js';
import { exitMathTransaction, updateMathTransaction } from './math-navigation.js';
import { editorSource, hydrateSource, snapshot } from './source.js';

const schema = getSchema(researchExtensions());
const editors: Editor[] = [];
const create = (source: string, limit?: number) => {
  const editor = new Editor({
    extensions: researchExtensions({}, limit ? { source: limit } : undefined),
    content: hydrateSource(source, schema),
  });
  editors.push(editor);
  return editor;
};
afterEach(() => editors.splice(0).forEach((e) => e.destroy()));
const mathNodes = (editor: Editor) => {
  const nodes: { pos: number; tex: string; type: string }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (['mathBlock', 'mathInline'].includes(node.type.name))
      nodes.push({ pos, tex: node.attrs.tex, type: node.type.name });
  });
  return nodes;
};
describe('scientific equation/document contract', () => {
  it('retains exact untouched bytes and transports display and inline equations through HTML and Markdown', () => {
    for (const newline of ['\n', '\r\n']) {
      for (const tex of [
        '\\frac{a}{b}',
        '\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}',
        '\\int_0^1 f(x)\\,dx',
        '\\unknowncommand{Ω}',
        '\\text{literal $ and <tag>}',
      ]) {
        const source = ['Before  😀.', '', '$$', tex, '$$', '', `Inline $x_1$ after.`, ''].join(newline);
        const e = create(source);
        expect(mathNodes(e).map((n) => [n.type, n.tex])).toEqual([
          ['mathBlock', tex],
          ['mathInline', 'x_1'],
        ]);
        expect(editorSource(e.state.doc)).toBe(source);
        const element = document.createElement('div');
        element.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(e.state.doc.content));
        const copied = DOMParser.fromSchema(schema).parse(element);
        const restored = create(editorSource(copied));
        expect(mathNodes(restored).map((n) => [n.type, n.tex])).toEqual(mathNodes(e).map((n) => [n.type, n.tex]));
      }
    }
  });
  it('keeps unknown math metadata as source instead of dropping it during projection', () => {
    const e = create('$$ numbered=eq1\nx=1\n$$');
    expect(e.state.doc.firstChild?.firstChild?.type.name).toBe('researchSource');
    expect(editorSource(e.state.doc)).toBe('$$ numbered=eq1\nx=1\n$$');
  });
  it('publishes the complete last equation transaction synchronously and undo restores exact source', () => {
    const before = '---\ntitle: Test\n---\nBefore.\r\n\r\n$$\n x^2 \n$$\r\n\r\n:::opaque\r\nKeep this.\r\n:::';
    const e = create(before),
      initial = snapshot(e.state.doc);
    const { pos } = mathNodes(e)[0]!;
    const tex = '\\begin{pmatrix}1&0\\\\0&1\\end{pmatrix}';
    e.view.dispatch(e.state.tr.setNodeMarkup(pos, undefined, { tex }));
    const changed = snapshot(e.state.doc).getSource();
    expect(changed).toContain(tex);
    expect(changed).toMatch(/^---\ntitle: Test\n---\nBefore\.\r\n\r\n/);
    expect(changed.endsWith('\r\n\r\n:::opaque\r\nKeep this.\r\n:::')).toBe(true);
    expect(initial.getSource()).toBe(before);
    e.commands.undo();
    expect(editorSource(e.state.doc)).toBe(before);
    e.commands.redo();
    expect(editorSource(e.state.doc)).toBe(changed);
  });
  it('keeps the selected equation active across consecutive edits and shared undo/redo', () => {
    for (const source of ['Before $x$ after.', '$$\nx\n$$']) {
      const e = create(source),
        { pos } = mathNodes(e)[0]!;
      e.commands.setNodeSelection(pos);
      for (const tex of ['x+1', 'x+12', 'x+123']) {
        e.view.dispatch(updateMathTransaction(e.state, pos, tex)!);
        expect(e.state.selection).toBeInstanceOf(NodeSelection);
        expect(e.state.selection.from).toBe(pos);
        expect(mathNodes(e)[0]?.tex).toBe(tex);
      }
      e.commands.undo();
      expect(editorSource(e.state.doc)).toBe(source);
      e.commands.redo();
      expect(mathNodes(e)[0]?.tex).toBe('x+123');
      expect(e.state.selection).toBeInstanceOf(NodeSelection);
    }
  });
  it('rejects excessive equation edits atomically and accepts subsequent valid changes', () => {
    const source = 'Before $x$ after.',
      e = create(source, 50),
      { pos } = mathNodes(e)[0]!;
    e.view.dispatch(e.state.tr.setNodeMarkup(pos, undefined, { tex: 'x'.repeat(60) }));
    expect(editorSource(e.state.doc)).toBe(source);
    e.view.dispatch(e.state.tr.setNodeMarkup(pos, undefined, { tex: 'y^2' }));
    expect(editorSource(e.state.doc)).toBe('Before $y^2$ after.');
  });
  it('enters inline math from either adjacent caret without skipping or modifying its source', () => {
    const source = 'Before $x^2$ after.',
      e = create(source),
      { pos } = mathNodes(e)[0]!;
    e.commands.setTextSelection(pos);
    e.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(e.state.selection).toBeInstanceOf(NodeSelection);
    expect(e.state.selection.from).toBe(pos);
    e.commands.setTextSelection(pos + 1);
    e.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    expect(e.state.selection).toBeInstanceOf(NodeSelection);
    expect(e.state.selection.from).toBe(pos);
    expect(editorSource(e.state.doc)).toBe(source);
    e.setEditable(false);
    e.commands.setTextSelection(pos);
    e.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(e.state.selection).toBeInstanceOf(TextSelection);
  });
});

describe('equation boundary navigation', () => {
  it('returns to either side of an inline equation without adding blocks or changing source', () => {
    for (const source of ['Before $x$ after.', '$x$ after.', 'Before $x$', '$x$']) {
      const e = create(source),
        { pos } = mathNodes(e)[0]!;
      for (const before of [true, false]) {
        const tr = exitMathTransaction(e.state, pos, before)!;
        expect(tr.docChanged).toBe(false);
        expect(tr.selection).toBeInstanceOf(TextSelection);
        expect(tr.selection.from).toBe(before ? pos : pos + 1);
        expect(editorSource(tr.doc)).toBe(source);
      }
    }
  });
  it('creates a text continuation only when a display equation has no reachable neighbour', () => {
    for (const before of [true, false]) {
      const e = create('$$\nx\n$$'),
        { pos } = mathNodes(e)[0]!;
      e.view.dispatch(exitMathTransaction(e.state, pos, before)!);
      expect(e.state.doc.childCount).toBe(2);
      expect(e.state.doc.child(before ? 0 : 1).firstChild?.type.name).toBe('paragraph');
      expect(e.state.selection).toBeInstanceOf(TextSelection);
      e.commands.undo();
      expect(editorSource(e.state.doc)).toBe('$$\nx\n$$');
    }
  });
});
