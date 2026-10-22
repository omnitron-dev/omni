import { createContext, useContext, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { PluginKey } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import katex from 'katex';
import { MathInput, type MathInputProps, type MathExit } from './math-input.js';
import { exitMathTransaction, updateMathTransaction } from './math-navigation.js';

export type ResearchMathOptions = Pick<MathInputProps, 'labels' | 'options' | 'maxLength' | 'locale'>;
export const mathEntryKey = new PluginKey<'start' | 'end'>('researchMathEntry');
export const ResearchMathContext = createContext<ResearchMathOptions & { readOnly?: boolean }>({});
/** Formula content is a document attribute; focus and engine state are ephemeral. */
export function MathNodeView({ node, editor, getPos, selected }: NodeViewProps) {
  const config = useContext(ResearchMathContext);
  const display = node.type.name === 'mathBlock',
    latex = String(node.attrs.tex);
  const active = selected && editor.isEditable && !config.readOnly;
  const preview = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!preview.current) return;
    try {
      katex.render(latex === '\\placeholder{}' ? '\\square' : latex, preview.current, {
        displayMode: display,
        trust: false,
        strict: 'error',
        throwOnError: true,
        maxExpand: 1000,
        maxSize: 20,
      });
    } catch {
      preview.current.textContent = latex || config.labels?.field || 'Equation';
    }
  }, [latex, display, active, config.labels?.field]);
  useEffect(() => {
    if (active) editor.view.dispatch(closeHistory(editor.state.tr));
    return () => {
      if (active && !editor.isDestroyed) editor.view.dispatch(closeHistory(editor.state.tr));
    };
  }, [active, editor]);
  function exit(direction: MathExit) {
    const pos = getPos();
    if (typeof pos !== 'number' || editor.isDestroyed) return;
    const before = direction === 'backward' || direction === 'upward';
    const tr = exitMathTransaction(editor.state, pos, before);
    // Remove the inner editable before restoring ProseMirror's DOM selection.
    // Otherwise the departing field can consume the next keystroke.
    if (tr) flushSync(() => editor.view.dispatch(tr));
    editor.view.focus();
  }
  return (
    <NodeViewWrapper
      as={display ? 'div' : 'span'}
      className={`prism-science__math${display ? ' prism-science__math--display' : ''}`}
      contentEditable={false}
    >
      {active ? (
        <MathInput
          {...config}
          value={latex}
          display={display}
          entry={mathEntryKey.getState(editor.state)}
          autoFocus
          onChange={(input) => {
            const value = input || '\\placeholder{}';
            const pos = getPos();
            if (!editor.isEditable || typeof pos !== 'number' || editor.state.doc.nodeAt(pos)?.type !== node.type)
              return false;
            if (value === editor.state.doc.nodeAt(pos)?.attrs.tex) return true;
            const tr = updateMathTransaction(editor.state, pos, value);
            if (!tr) return false;
            editor.view.dispatch(tr);
            return editor.state.doc.nodeAt(pos)?.attrs.tex === value;
          }}
          onExit={exit}
          onHistory={(redo) => {
            if (redo) editor.commands.redo();
            else editor.commands.undo();
          }}
        />
      ) : (
        <span
          ref={preview}
          role={editor.isEditable && !config.readOnly ? 'button' : 'math'}
          tabIndex={editor.isEditable && !config.readOnly ? 0 : undefined}
          aria-label={`${config.labels?.field ?? 'Equation'}: ${latex}`}
          className="prism-science__math-preview"
          onClick={() => {
            const pos = getPos();
            if (editor.isEditable && !config.readOnly && typeof pos === 'number') editor.commands.setNodeSelection(pos);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.currentTarget.click();
            }
          }}
        />
      )}
    </NodeViewWrapper>
  );
}
