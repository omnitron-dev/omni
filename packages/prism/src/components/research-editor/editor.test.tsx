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

describe('contextual block editing', () => {
  it('opens the selected block from the toolbar and the hovered block from the context menu', async () => {
    const source = 'First.\n\n$$\nx^2+y^2=z^2\n$$';
    const { container } = render(
      <TestWrapper>
        <ResearchEditor initialSource={source} />
      </TestWrapper>
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Block source' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Block source' }));
    expect(await screen.findByRole('textbox', { name: 'Block source' })).toHaveValue('First.');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.pointerMove(container.querySelectorAll('[data-research-block]')[1]!);
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Block actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Block source' }));
    expect(await screen.findByRole('textbox', { name: 'Block source' })).toHaveValue('$$\nx^2+y^2=z^2\n$$');
  });
  it('duplicates the hovered scientific block through its own menu and preserves the source on undo', async () => {
    const source = 'First.\n\n$$\nx^2+y^2=z^2\n$$';
    const ref = createRef<ResearchEditorHandle>();
    const { container } = render(
      <TestWrapper>
        <ResearchEditor ref={ref} initialSource={source} />
      </TestWrapper>
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Block actions' })).toBeEnabled());
    fireEvent.pointerMove(container.querySelectorAll('[data-research-block]')[1]!);
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Block actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate block' }));
    expect(ref.current!.getSnapshot().getSource()).toBe(source + '\n\n$$\nx^2+y^2=z^2\n$$');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(ref.current!.getSnapshot().getSource()).toBe(source);
  });
  it('closes editing dialogs when permission is revoked while a dialog is open', async () => {
    const ref = createRef<ResearchEditorHandle>();
    const { rerender } = render(
      <TestWrapper>
        <ResearchEditor ref={ref} initialSource="Original" />
      </TestWrapper>
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Document source' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Document source' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Document source' }), { target: { value: 'Unadmitted' } });
    rerender(
      <TestWrapper>
        <ResearchEditor ref={ref} initialSource="Original" readOnly />
      </TestWrapper>
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument());
    expect(ref.current!.getSnapshot().getSource()).toBe('Original');
    expect(screen.queryByRole('button', { name: 'Block actions' })).not.toBeInTheDocument();
  });
});
