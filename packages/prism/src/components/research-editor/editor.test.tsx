import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRef } from 'react';
import { render, fireEvent, screen, waitFor, cleanup, act } from '@testing-library/react';
import type { Editor as TiptapEditor } from '@tiptap/core';
import { Editor } from '../editor/editor.js';
import { ResearchEditor, type ResearchEditorHandle } from './editor.js';
import { TestWrapper } from '../../../tests/fixtures/test-utils.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('Editor transaction delivery', () => {
  it('publishes legacy Editor changes before the save caller can read stale state', async () => {
    let engine: TiptapEditor | undefined;
    let value = '';
    render(
      <TestWrapper>
        <Editor
          toolbar="minimal"
          bubbleMenu={false}
          value="<p>initial</p>"
          format="html"
          onCreate={({ editor }) => {
            engine = editor;
          }}
          onChange={(v) => {
            value = v;
          }}
        />
      </TestWrapper>
    );
    await waitFor(() => expect(engine).toBeDefined());
    act(() => {
      engine!.commands.insertContent('last keystroke');
    });
    expect(value).toContain('last keystroke');
  });
  it('uses the same source and transactions for source editing, undo and immediate snapshots', async () => {
    const ref = createRef<ResearchEditorHandle>(),
      changed = vi.fn();
    render(
      <TestWrapper>
        <ResearchEditor ref={ref} initialSource={'# A\r\n\r\nOriginal.'} onChange={changed} />
      </TestWrapper>
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Document source' })).toBeEnabled());
    expect(ref.current!.getSnapshot().getSource()).toBe('# A\r\n\r\nOriginal.');
    expect(screen.getByText('1 / 2 blocks')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Document source' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Document source' }), {
      target: { value: '# A\n\nChanged **claim**.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(ref.current!.getSnapshot().getSource()).toBe('# A\n\nChanged **claim**.');
    expect(changed.mock.lastCall?.[0].getSource()).toBe('# A\n\nChanged **claim**.');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(ref.current!.getSnapshot().getSource()).toBe('# A\r\n\r\nOriginal.');
  });
  it('disables the contenteditable surface itself when locked', async () => {
    const { rerender } = render(
      <TestWrapper>
        <ResearchEditor initialSource="Source" />
      </TestWrapper>
    );
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Research document' })).toHaveAttribute('contenteditable', 'true')
    );
    rerender(
      <TestWrapper>
        <ResearchEditor initialSource="Source" readOnly />
      </TestWrapper>
    );
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Research document' })).toHaveAttribute('contenteditable', 'false')
    );
  });
});

describe('scientific registry scope', () => {
  it('re-evaluates host capabilities without losing the draft when a registry is revoked', async () => {
    // The DOM simulator has no viewport layout; exercise the supported eager fallback.
    vi.stubGlobal('IntersectionObserver', undefined);
    const source = '```prism\n{"type":"probe","version":1,"props":{}}\n```';
    const ref = createRef<ResearchEditorHandle>();
    const { rerender } = render(
      <TestWrapper>
        <ResearchEditor
          ref={ref}
          initialSource={source}
          widgets={{ probe: { version: 1, render: () => <span>Allowed capability</span> } }}
        />
      </TestWrapper>
    );
    await waitFor(() => expect(screen.getByText('Allowed capability')).toBeInTheDocument());
    rerender(
      <TestWrapper>
        <ResearchEditor ref={ref} initialSource={source} widgets={{}} />
      </TestWrapper>
    );
    await waitFor(() => expect(screen.queryByText('Allowed capability')).not.toBeInTheDocument());
    expect(screen.getByText('This block is not available in this document.')).toBeInTheDocument();
    expect(ref.current!.getSnapshot().getSource()).toBe(source);
  });
});
