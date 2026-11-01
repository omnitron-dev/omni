// @vitest-environment happy-dom
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import CodeEditor from './code-editor';
vi.mock('@omnitron-dev/prism/core', () => ({ usePrismContext: () => ({ settings: { mode: 'light' } }) }));
beforeAll(() => {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
});
afterEach(cleanup);

it('preserves the buffer, cursor and undo history when theme, wrapping, label and readonly change', () => {
  const change = vi.fn(), save = vi.fn();
  const light = createTheme(), dark = createTheme({ palette: { mode: 'dark' } });
  const editor = (theme = light, readOnly = false, wrap = false, name = 'original.txt') => <ThemeProvider theme={theme}>
    <CodeEditor initial="saved" name={name} readOnly={readOnly} wrap={wrap} active={false} onChange={change} onSave={save} />
  </ThemeProvider>;
  const mounted = render(editor());
  const content = mounted.container.querySelector<HTMLElement>('.cm-content')!;
  const view = EditorView.findFromDOM(content)!;
  view.dispatch({ changes: { from: 5, insert: ' + unsaved' }, selection: { anchor: 8 } });
  expect(change).toHaveBeenLastCalledWith('saved + unsaved');
  mounted.rerender(editor(dark, true, true, 'renamed.txt'));
  expect(EditorView.findFromDOM(mounted.container.querySelector('.cm-content')!)).toBe(view);
  expect(view.state.doc.toString()).toBe('saved + unsaved');
  expect(view.state.selection.main.head).toBe(8);
  expect(view.contentDOM.getAttribute('aria-label')).toBe('Edit renamed.txt');
  expect(mounted.container.querySelector('.cm-lineWrapping')).toBeTruthy();
  fireEvent.keyDown(view.contentDOM, { key: 's', ctrlKey: true });
  expect(save).not.toHaveBeenCalled();
  mounted.rerender(editor(dark, false, true, 'renamed.txt'));
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe('saved');
});

it('reports line/column selection while preserving original CRLF when the buffer changes', () => {
  const change = vi.fn(), position = vi.fn();
  const { container } = render(<ThemeProvider theme={createTheme()}>
    <CodeEditor initial={'first\r\nsecond'} name="text.txt" readOnly={false} active={false} onChange={change} onSave={() => {}} onPosition={position} />
  </ThemeProvider>);
  const view = EditorView.findFromDOM(container.querySelector('.cm-content')!)!;
  view.dispatch({ selection: { anchor: 6, head: 8 } });
  expect(position).toHaveBeenLastCalledWith({ line: 2, column: 3, selected: 2 });
  view.dispatch({ changes: { from: view.state.doc.length, insert: '!' } });
  expect(change).toHaveBeenLastCalledWith('first\r\nsecond!');
});
