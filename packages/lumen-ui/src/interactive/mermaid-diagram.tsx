import React, { useEffect, useId, useState } from 'react';
import { renderDiagramSvg } from '@omnitron-dev/lumen-ast/diagrams';
import { useTheme } from '@mui/material/styles';
import { useLumen } from '../hydration/context.js';

export interface MermaidDiagramProps {
  code: string;
}

type DiagramState = { status: 'loading' } | { status: 'ready'; svg: string } | { status: 'error'; message: string };

/** Uses the actual Mermaid engine; invalid diagrams retain their source and error. */
export function MermaidDiagram({ code }: MermaidDiagramProps): React.JSX.Element {
  const { theme } = useLumen();
  const { palette, typography } = useTheme();
  const id = `lumen-mermaid-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const [state, setState] = useState<DiagramState>({ status: 'loading' });
  useEffect(() => {
    const abort = new AbortController();
    setState({ status: 'loading' });
    void renderDiagramSvg(code, id, {
      theme: theme === 'dark' ? 'dark' : 'light', signal: abort.signal,
      colors: { surface: palette.background.paper, foreground: palette.text.primary, muted: palette.text.secondary, accent: palette.primary.main, border: palette.text.secondary },
      fontFamily: typography.fontFamily,
    })
      .then(svg => { if (!abort.signal.aborted) setState({ status: 'ready', svg }); })
      .catch(error => { if (!abort.signal.aborted) setState({ status: 'error', message: error instanceof Error ? error.message : 'Diagram rendering failed' }); });
    return () => abort.abort();
  }, [code, id, theme, palette, typography.fontFamily]);

  return <>
    {state.status === 'loading' && <p role="status">Rendering diagram…</p>}
    {state.status === 'error' && <p role="alert">Diagram unavailable: {state.message}</p>}
    {state.status === 'ready' && <div className="lumen-diagram-content" style={{ overflowX: 'auto' }} dangerouslySetInnerHTML={{ __html: state.svg }} />}
    <details open={state.status === 'error'} className="lumen-diagram-source">
      <summary>Diagram source</summary>
      <pre><code>{code}</code></pre>
    </details>
  </>;
}
