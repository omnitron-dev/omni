import { useEffect, useRef } from 'react';
import { Box, useMediaQuery, useTheme } from '@mui/material';
import { getContrastRatio } from '@mui/material/styles';
import { usePrismContext } from '@omnitron-dev/prism/core';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
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
  const { settings } = usePrismContext();
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const dark = settings.mode === 'system' ? prefersDark : settings.mode === 'dark';
  const content = useRef(initial);
  content.current = initial;
  useEffect(() => {
    if (!host.current) return undefined;
    const ending = lineEnding(content.current);
    // Prism's tonal scales adapt to the scheme; choose by contrast instead of shade names.
    const accent = (color: typeof theme.palette.primary & { lighter?: string; darker?: string }) =>
      [color.main, color.light, color.dark, color.darker, color.lighter].find(
        (candidate) => candidate && getContrastRatio(candidate, theme.palette.background.default) >= 4.5
      ) ?? theme.palette.text.primary;
    const language = new Compartment();
    let disposed = false;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: content.current,
        extensions: [
          basicSetup,
          syntaxHighlighting(
            HighlightStyle.define([
              { tag: tags.keyword, color: accent(theme.palette.primary) },
              { tag: [tags.string, tags.special(tags.string)], color: accent(theme.palette.success) },
              { tag: [tags.number, tags.bool, tags.null], color: accent(theme.palette.warning) },
              { tag: [tags.function(tags.variableName), tags.typeName], color: accent(theme.palette.info) },
              { tag: tags.comment, color: theme.palette.text.secondary, fontStyle: 'italic' },
              { tag: [tags.name, tags.punctuation, tags.operator], color: theme.palette.text.primary },
              { tag: tags.invalid, color: accent(theme.palette.error), textDecoration: 'underline' },
            ])
          ),
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
            { dark }
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
  }, [name, readOnly, theme, dark]);
  return (
    <Box
      ref={host}
      sx={{ flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden', '& > .cm-editor': { height: '100%' } }}
    />
  );
}
