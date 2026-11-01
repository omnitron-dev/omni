import { useEffect, useMemo, useRef } from 'react';
import { Box, useMediaQuery, useTheme } from '@mui/material';
import { getContrastRatio, type Theme } from '@mui/material/styles';
import { usePrismContext } from '@omnitron-dev/prism/core';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { lineEnding } from './model';

export interface EditorPosition { line: number; column: number; selected: number }
function position(editor: EditorView): EditorPosition {
  const selection = editor.state.selection.main;
  const line = editor.state.doc.lineAt(selection.head);
  return { line: line.number, column: selection.head - line.from + 1, selected: selection.to - selection.from };
}

function appearance(theme: Theme, dark: boolean): Extension {
  const accent = (color: typeof theme.palette.primary & { lighter?: string; darker?: string }) =>
    [color.main, color.light, color.dark, color.darker, color.lighter].find(
      candidate => candidate && getContrastRatio(candidate, theme.palette.background.default) >= 4.5,
    ) ?? theme.palette.text.primary;
  return [
    syntaxHighlighting(HighlightStyle.define([
      { tag: tags.keyword, color: accent(theme.palette.primary) },
      { tag: [tags.string, tags.special(tags.string)], color: accent(theme.palette.success) },
      { tag: [tags.number, tags.bool, tags.null], color: accent(theme.palette.warning) },
      { tag: [tags.function(tags.variableName), tags.typeName], color: accent(theme.palette.info) },
      { tag: tags.comment, color: theme.palette.text.secondary, fontStyle: 'italic' },
      { tag: [tags.name, tags.punctuation, tags.operator], color: theme.palette.text.primary },
      { tag: tags.invalid, color: accent(theme.palette.error), textDecoration: 'underline' },
    ])),
    EditorView.theme({
      '&': { height: '100%', color: theme.palette.text.primary, backgroundColor: theme.palette.background.default },
      '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '13px', lineHeight: '1.65' },
      '.cm-content': { padding: '12px 0', caretColor: theme.palette.primary.main },
      '.cm-gutters': { backgroundColor: theme.palette.background.paper, color: theme.palette.text.secondary, border: 'none' },
      '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: theme.palette.action.hover },
      '&.cm-focused': { outline: 'none' },
      '.cm-panels': { backgroundColor: theme.palette.background.paper, color: theme.palette.text.primary },
      '.cm-search': { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px', padding: '6px' },
      '.cm-textfield': { minWidth: '80px', maxWidth: '100%', color: theme.palette.text.primary, backgroundColor: theme.palette.background.default, border: `1px solid ${theme.palette.divider}`, borderRadius: '4px' },
      '.cm-button': { color: theme.palette.text.primary, backgroundImage: 'none', backgroundColor: theme.palette.action.hover, border: `1px solid ${theme.palette.divider}`, borderRadius: '4px' },
    }, { dark }),
  ];
}

/** One view per buffer: theme, wrapping, readonly and language changes never replace its history. */
export default function CodeEditor({ initial, name, readOnly, active = true, wrap = false, onChange, onSave, onPosition }: {
  initial: string;
  name: string;
  readOnly: boolean;
  active?: boolean;
  wrap?: boolean;
  onChange: (text: string) => void;
  onSave: () => void;
  onPosition?: (position: EditorPosition) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onSave, onPosition });
  callbacks.current = { onChange, onSave, onPosition };
  const theme = useTheme();
  const { settings } = usePrismContext();
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const dark = settings.mode === 'system' ? prefersDark : settings.mode === 'dark';
  const visual = useMemo(() => appearance(theme, dark), [theme, dark]);
  const compartments = useRef({ visual: new Compartment(), language: new Compartment(), policy: new Compartment(), wrap: new Compartment(), label: new Compartment() });
  const first = useRef({ initial, ending: lineEnding(initial) });
  useEffect(() => {
    if (!host.current) return undefined;
    const { ending } = first.current;
    const editor = new EditorView({ parent: host.current, state: EditorState.create({
      doc: first.current.initial,
      extensions: [basicSetup,
        compartments.current.visual.of([]), compartments.current.language.of([]), compartments.current.policy.of([]), compartments.current.wrap.of([]), compartments.current.label.of([]),
        keymap.of([{ key: 'Mod-s', run: currentView => { if (!currentView.state.facet(EditorState.readOnly)) callbacks.current.onSave(); return true; } }, indentWithTab]),
        EditorState.lineSeparator.of(ending === 'mixed' ? '\n' : ending),
        EditorView.updateListener.of(update => {
          if (update.docChanged) callbacks.current.onChange(update.state.sliceDoc());
          if (update.docChanged || update.selectionSet) callbacks.current.onPosition?.(position(update.view));
        }),
      ],
    }) });
    view.current = editor;
    return () => { view.current = null; editor.destroy(); };
  }, []);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const immutable = readOnly || first.current.ending === 'mixed';
    editor.dispatch({ effects: [
      compartments.current.visual.reconfigure(visual),
      compartments.current.policy.reconfigure([EditorState.readOnly.of(immutable), EditorView.editable.of(!immutable)]),
      compartments.current.wrap.reconfigure(wrap ? EditorView.lineWrapping : []),
      compartments.current.label.reconfigure(EditorView.contentAttributes.of({ 'aria-label': `Edit ${name}`, 'data-keyboard-focus': '', tabindex: '0', spellcheck: 'false' })),
    ] });
  }, [visual, readOnly, wrap, name]);
  useEffect(() => {
    let disposed = false;
    const syntax = /\.jsonc?$/.test(name)
      ? import('@codemirror/lang-json').then(module => module.json())
      : /\.[cm]?[jt]sx?$/.test(name)
        ? import('@codemirror/lang-javascript').then(module => module.javascript({ typescript: /tsx?$/.test(name), jsx: /[jt]sx$/.test(name) }))
        : Promise.resolve([]);
    void syntax.then(extension => { if (!disposed) view.current?.dispatch({ effects: compartments.current.language.reconfigure(extension) }); }).catch(() => undefined);
    return () => { disposed = true; };
  }, [name]);
  useEffect(() => {
    if (!active) return undefined;
    const frame = requestAnimationFrame(() => {
      const editor = view.current;
      if (editor) { editor.requestMeasure(); editor.focus(); callbacks.current.onPosition?.(position(editor)); }
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);
  return <Box ref={host} data-keyboard-region="File editor" data-keyboard-native
    sx={{ flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden', '& > .cm-editor': { height: '100%' } }} />;
}
