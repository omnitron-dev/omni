import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { Editor as TiptapEditor } from '@tiptap/core';
import { Editor } from './editor.js';
import { TestWrapper } from '../../../tests/fixtures/test-utils.js';

afterEach(cleanup);
const doc = (text: string) =>
  JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

describe('Editor value synchronization', () => {
  for (const format of ['json', 'html'] as const) {
    it(`replaces non-empty ${format} values and clears without reporting a user edit`, async () => {
      const changed = vi.fn();
      let engine: TiptapEditor | undefined;
      const value = (text: string) => (format === 'json' ? doc(text) : `<p>${text}</p>`);
      const view = (text: string) => (
        <TestWrapper>
          <Editor
            toolbar="minimal"
            bubbleMenu={false}
            value={text ? value(text) : ''}
            format={format}
            onChange={changed}
            onCreate={({ editor }) => {
              engine = editor;
            }}
          />
        </TestWrapper>
      );
      const { rerender, container } = render(view('Original document'));
      await waitFor(() => expect(engine).toBeDefined());
      expect(container.querySelector('.tiptap')).toHaveTextContent('Original document');
      rerender(view('Replacement document'));
      await waitFor(() => expect(engine!.getText()).toBe('Replacement document'));
      expect(container.querySelector('.tiptap')).toHaveTextContent('Replacement document');
      rerender(view(''));
      await waitFor(() => expect(engine!.isEmpty).toBe(true));
      expect(changed).not.toHaveBeenCalled();
    });

    it(`keeps cursor, undo, and immediate ${format} changes when the host echoes the value`, async () => {
      let engine: TiptapEditor | undefined;
      const changed = vi.fn();
      function Form() {
        const [value, setValue] = useState(format === 'json' ? doc('First last') : '<p>First last</p>');
        return (
          <TestWrapper>
            <Editor
              toolbar="minimal"
              bubbleMenu={false}
              value={value}
              format={format}
              onCreate={({ editor }) => {
                engine = editor;
              }}
              onChange={(next) => {
                changed(next);
                setValue(next);
              }}
            />
          </TestWrapper>
        );
      }
      render(<Form />);
      await waitFor(() => expect(engine).toBeDefined());
      act(() => {
        engine!.commands.setTextSelection(7);
        engine!.commands.insertContent('new ');
      });
      expect(engine!.getText()).toBe('First new last');
      expect(engine!.state.selection.from).toBe(11);
      expect(changed).toHaveBeenCalledTimes(1);
      expect(changed.mock.lastCall![0]).toContain('First new last');
      act(() => {
        engine!.commands.undo();
      });
      expect(engine!.getText()).toBe('First last');
      expect(changed).toHaveBeenCalledTimes(2);
    });
  }

  it('switches inherited read-only content back to the editable document', async () => {
    let engine: TiptapEditor | undefined;
    const changed = vi.fn();
    const view = (inherited: boolean) => (
      <TestWrapper>
        <Editor
          toolbar="minimal"
          bubbleMenu={false}
          value={inherited ? doc('Shared description') : 'Local description'}
          editable={!inherited}
          onChange={changed}
          onCreate={({ editor }) => {
            engine = editor;
          }}
        />
      </TestWrapper>
    );
    const { rerender, container } = render(view(true));
    await waitFor(() => expect(engine).toBeDefined());
    rerender(view(false));
    await waitFor(() => expect(container.querySelector('.tiptap')).toHaveTextContent('Local description'));
    expect(container.querySelector('.tiptap')).toHaveAttribute('contenteditable', 'true');
    rerender(view(true));
    await waitFor(() => expect(container.querySelector('.tiptap')).toHaveTextContent('Shared description'));
    expect(container.querySelector('.tiptap')).toHaveAttribute('contenteditable', 'false');
    expect(changed).not.toHaveBeenCalled();
  });
});
