import { useMemo, useRef, useState } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { createPrismTheme } from '../../../src/theme';
import { ResearchEditor, type ResearchEditorHandle } from '../../../src/components/research-editor';
export function ResearchTestPage() {
  const editor = useRef<ResearchEditorHandle>(null);
  const [locked, setLocked] = useState(false),
    [dark, setDark] = useState(false),
    [saved, setSaved] = useState('');
  const theme = useMemo(() => createPrismTheme({ mode: dark ? 'dark' : 'light' }), [dark]);
  const count = Math.min(2000, Number(new URLSearchParams(location.search).get('blocks')) || 0);
  const source = count
    ? Array.from({ length: count }, (_, i) => `Statement ${i}: precise source with Unicode Ω and 😀.`).join('\n\n')
    : 'First statement.\r\n\r\n$$\nx^2+y^2=z^2\n$$\n\nThird statement.\n';
  return (
    <ThemeProvider theme={theme}>
      <main style={{ padding: 16, background: theme.palette.background.paper, color: theme.palette.text.primary }}>
        <h1>Research editor acceptance</h1>
        <label>
          <input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} />
          Read only
        </label>
        <label>
          <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} />
          Dark theme
        </label>
        <ResearchEditor ref={editor} initialSource={source} readOnly={locked} />
        <button type="button" onClick={() => setSaved(editor.current!.getSnapshot().getSource())}>
          Capture source
        </button>
        <label>
          Captured source
          <textarea aria-label="Captured source" value={saved} readOnly style={{ width: '100%', minHeight: 100 }} />
        </label>
        <output data-testid="captured-json" hidden>
          {JSON.stringify(saved)}
        </output>
      </main>
    </ThemeProvider>
  );
}
