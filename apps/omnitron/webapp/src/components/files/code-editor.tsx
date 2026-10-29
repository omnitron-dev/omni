import { useEffect, useRef } from 'react';
import { Box, useTheme } from '@mui/material';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { basicSetup } from 'codemirror';
import { lineEnding } from './model';

/** One view per document. The buffer belongs to the workspace, not to the DOM lifecycle. */
export default function CodeEditor({
  initial,
  name,
  readOnly,
  onChange,
  onSave,
}: {
  initial: string;
  name: string;
  readOnly: boolean;
  onChange: (text: string) => void;
  onSave: () => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    callbacks = useRef({ onChange, onSave });
  callbacks.current = { onChange, onSave };
  const theme = useTheme();
  const content = useRef(initial);
  content.current = initial;
  useEffect(() => {
    if (!host.current) return undefined;
    const ending = lineEnding(content.current);
    const language = new Compartment();
    let disposed = false;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: content.current,
        extensions: [
          basicSetup,
          language.of([]),
          keymap.of([
            {
              key: 'Mod-s',
              run: () => {
                callbacks.current.onSave();
                return true;
              },
            },
            indentWithTab,
          ]),
          EditorState.readOnly.of(readOnly || ending === 'mixed'),
          EditorView.editable.of(!readOnly && ending !== 'mixed'),
          EditorState.lineSeparator.of(ending === 'mixed' ? '\n' : ending),
          EditorView.contentAttributes.of({ 'aria-label': `Edit ${name}`, spellcheck: 'false' }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.current.onChange(update.state.sliceDoc());
          }),
          EditorView.theme(
            {
              '&': {
                height: '100%',
                color: theme.palette.text.primary,
                backgroundColor: theme.palette.background.default,
              },
              '.cm-scroller': {
                overflow: 'auto',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: '13px',
                lineHeight: '1.65',
              },
              '.cm-content': { padding: '12px 0', caretColor: theme.palette.primary.main },
              '.cm-gutters': {
                backgroundColor: theme.palette.background.paper,
                color: theme.palette.text.secondary,
                border: 'none',
              },
              '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: theme.palette.action.hover },
              '&.cm-focused': { outline: 'none' },
              '.cm-panels': { backgroundColor: theme.palette.background.paper, color: theme.palette.text.primary },
            },
            { dark: theme.palette.mode === 'dark' }
          ),
        ],
      }),
    });
    const syntax = /\.jsonc?$/.test(name)
      ? import('@codemirror/lang-json').then((module) => module.json())
      : /\.[cm]?[jt]sx?$/.test(name)
        ? import('@codemirror/lang-javascript').then((module) =>
            module.javascript({ typescript: /tsx?$/.test(name), jsx: /[jt]sx$/.test(name) })
          )
        : Promise.resolve([]);
    void syntax
      .then((extension) => {
        if (!disposed) editor.dispatch({ effects: language.reconfigure(extension) });
      })
      .catch(() => {
        /* Plain-text editing remains available if a syntax chunk cannot load. */
      });
    return () => {
      disposed = true;
      editor.destroy();
    };
    // Changing text on each keystroke would destroy undo history; a new document gets a new component key.
  }, [name, readOnly, theme]);
  return (
    <Box
      ref={host}
      sx={{ flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden', '& > .cm-editor': { height: '100%' } }}
    />
  );
}
