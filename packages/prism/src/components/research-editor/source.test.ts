import { describe, it, expect, afterEach, vi } from 'vitest';
import { DOMParser, DOMSerializer } from '@tiptap/pm/model';
import { Editor, getSchema } from '@tiptap/core';
import { researchExtensions } from './extensions.js';
import { sourceDocument, hydrateSource, editorSource, snapshot } from './source.js';
const extensions = researchExtensions(),
  schema = getSchema(extensions);
const read = (source: string) => schema.nodeFromJSON(hydrateSource(source, schema));
const editors: Editor[] = [];
const edit = (source: string) => {
  const e = new Editor({ extensions, content: hydrateSource(source, schema) });
  editors.push(e);
  return e;
};
afterEach(() => editors.splice(0).forEach((e) => e.destroy()));
describe('Research editor source invariants', () => {
  it('roundtrips exact source, including whitespace, references, unknown syntax and scientific blocks', () => {
    const samples = [
      '',
      ' \r\n\t',
      '\n# Title\r\n\r\nA **claim** with $x^2$ and 😀.  \r\nNext.\r\n',
      '- [ ] Task\n- [x] Done',
      '- ordinary\n- [ ] mixed',
      '4. one\n5. two',
      '> multi\n> line',
      '| a | b |\n| --- | --- |\n| c | d |',
      '| a | b |\n| :--- | ---: |\n| c | d |',
      '```rust title="x"\nlet x=1;\n```',
      '[citation][r]\n\n[r]: https://example.org "source"',
      ':::unknown\nRetain exactly.\n:::',
      '$$\n\\int f(x)\\,dx\n$$',
      '<script>doNotRun()</script>',
      '```prism\n{"type":"future","version":4,"props":{"x":3}}\n```',
      '```mermaid\ngraph LR\n A-->B\n```',
    ];
    for (const s of samples) expect(editorSource(read(s)), s).toBe(s);
    for (let i = 0; i < 160; i++) {
      const s = `${'\n'.repeat(i % 3)}## 第${i} глава\r\n\r\nText **${i}** $x_${i}$ 🧑‍🔬.\r\n\r\n\`\`\`unknown\r\n<opaque ${i}>\r\n\`\`\`\r\n`;
      expect(editorSource(read(s))).toBe(s);
    }
  });
  it('edits one block without rewriting neighbours, and undo restores exact source', () => {
    const s = '# Заголовок\r\n\r\nA **claim**.\r\n\r\n:::future\r\nKeep bytes.\r\n:::\r\n';
    const e = edit(s);
    let pos = 0;
    e.state.doc.descendants((n, p) => {
      if (n.isText && n.text === 'A ') pos = p;
    });
    const initial = snapshot(e.state.doc);
    e.view.dispatch(e.state.tr.insertText('New ', pos));
    const after = editorSource(e.state.doc);
    expect(after).toContain('New A **claim**.');
    expect(after.endsWith('\r\n\r\n:::future\r\nKeep bytes.\r\n:::\r\n')).toBe(true);
    expect(initial.getSource()).toBe(s);
    e.commands.undo();
    expect(editorSource(e.state.doc)).toBe(s);
    e.commands.redo();
    expect(editorSource(e.state.doc)).toBe(after);
  });
  it('serializes edited structured content with escaping, links, lists and formulas', () => {
    for (const s of [
      'A **bold** and *italic* and `code` and [link](https://example.org).',
      '- first\n- second',
      '- [ ] first\n- [x] second',
      '| A | B |\n| --- | --- |\n| x | y |',
      'A $x^2$ formula.',
    ]) {
      const e = edit(s);
      let pos = -1;
      e.state.doc.descendants((n, p) => {
        if (pos < 0 && n.isText) pos = p;
      });
      e.view.dispatch(e.state.tr.insertText('literal * [ ', pos));
      const next = editorSource(e.state.doc);
      expect(() => read(next)).not.toThrow();
      expect(next).toContain('literal');
      expect(next).toContain('\\*');
      if (s.includes('$x^2$')) expect(next).toContain('$x^2$');
    }
  });
  it('rejects oversized input and unsupported nodes instead of silently deleting them', () => {
    expect(() => sourceDocument('x'.repeat(262145))).toThrow('document_limit');
    expect(() => schema.nodeFromJSON({ type: 'doc', content: [{ type: 'unknown' }] })).toThrow();
  });
  it('splits blocks and preserves unique stable IDs under undo/redo', () => {
    const e = edit('first second');
    e.commands.setTextSelection(7);
    e.commands.keyboardShortcut('Enter');
    expect(e.state.doc.childCount).toBe(2);
    const ids = e.state.doc.content.content.map((n) => n.attrs.id);
    expect(new Set(ids).size).toBe(2);
    expect(read(editorSource(e.state.doc)).child(0).textContent).toBe('first');
    expect(read(editorSource(e.state.doc)).child(1).textContent).toBe(' second');
    e.commands.undo();
    expect(editorSource(e.state.doc)).toBe('first second');
    e.commands.redo();
    expect(e.state.doc.childCount).toBe(2);
  });
});

describe('clipboard and rejected transaction integrity', () => {
  it('transports formulas and opaque scientific source through HTML without execution or text loss', () => {
    const source =
      'Formula $\\alpha_1+\\beta$ and **$x^2$**.\n\n```mermaid\ngraph LR\n A-->B\n```\n\n```prism\n{"type":"unknown","version":2}\n```';
    const original = read(source),
      element = document.createElement('div');
    element.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(original.content));
    const copied = DOMParser.fromSchema(schema).parse(element);
    const atoms = (doc: typeof original) => {
      const result: unknown[] = [];
      doc.descendants((node) => {
        if (['mathInline', 'researchSource'].includes(node.type.name))
          result.push([node.type.name, { ...node.attrs }, node.marks.map((m) => m.type.name)]);
      });
      return result;
    };
    expect(atoms(copied)).toEqual(atoms(original));
    expect(atoms(read(editorSource(copied)))).toEqual(atoms(original));
    expect(element.querySelector('script')).toBeNull();
  });
  it('rejects oversized transactions without truncation and permits subsequent valid edits', () => {
    const onLimit = vi.fn();
    const e = new Editor({
      extensions: researchExtensions({}, { source: 20, onLimit }),
      content: hydrateSource('original', schema),
    });
    editors.push(e);
    e.view.dispatch(e.state.tr.insertText('x'.repeat(30), 2));
    expect(editorSource(e.state.doc)).toBe('original');
    expect(onLimit).toHaveBeenCalledTimes(1);
    e.view.dispatch(e.state.tr.insertText('OK ', 2));
    expect(editorSource(e.state.doc)).toBe('OK original');
    e.commands.undo();
    expect(editorSource(e.state.doc)).toBe('original');
  });
  it('rejects table edits the source format cannot represent instead of discarding the span', () => {
    const source = '| a | b |\n| --- | --- |\n| c | d |';
    const onLimit = vi.fn();
    const e = new Editor({
      extensions: researchExtensions({}, { source: 10000, onLimit }),
      content: hydrateSource(source, schema),
    });
    editors.push(e);
    let cell = -1;
    e.state.doc.descendants((n, p) => {
      if (cell < 0 && (n.type.name === 'tableCell' || n.type.name === 'tableHeader')) cell = p;
    });
    e.view.dispatch(e.state.tr.setNodeMarkup(cell, undefined, { ...e.state.doc.nodeAt(cell)!.attrs, colspan: 2 }));
    expect(editorSource(e.state.doc)).toBe(source);
    expect(onLimit).toHaveBeenCalledTimes(1);
  });
});

it('keeps YAML metadata atomic and exact when the adjacent paragraph is edited and undone', () => {
  const metadata = '---\r\ntitle: "Ω 😀"\r\nslug: /domain/example\r\n---\r\n';
  const source = metadata + '\r\nA claim.\r\n';
  const editor = edit(source);
  expect(editor.state.doc.firstChild?.firstChild?.type.name).toBe('researchSource');
  expect(editorSource(editor.state.doc)).toBe(source);
  let position = 0;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === 'A claim.') position = pos;
  });
  editor.commands.insertContentAt(position, 'New ');
  expect(editorSource(editor.state.doc).startsWith(metadata)).toBe(true);
  expect(editorSource(editor.state.doc)).toContain('New A claim.');
  editor.commands.undo();
  expect(editorSource(editor.state.doc)).toBe(source);
});
