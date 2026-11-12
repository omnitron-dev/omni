'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTheme } from '@mui/material/styles';
import { runExclusive } from '@omnitron-dev/common';
import type { ResearchLabels } from './document.js';
import { researchLimits } from './parse.js';
import { diagramImage, diagramLabelPolicy } from './diagram-image.js';
export function diagramSourceAllowed(source: string, engine: string) {
  return (
    engine === 'mermaid' && source.length <= researchLimits.block && !/^\s*---/m.test(source) && !/%%\s*\{/.test(source)
  );
}
export function ResearchDiagram({
  source,
  engine,
  labels,
}: {
  source: string;
  engine: string;
  labels: ResearchLabels;
}) {
  const id = `diagram-${useId().replace(/[^\w-]/g, '')}`;
  const container = useRef<HTMLDivElement>(null);
  const [picture, setPicture] = useState<ReturnType<typeof diagramImage>>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const theme = useTheme(),
    mode = theme.palette.mode;
  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setPicture(undefined);
    const target = container.current;
    const run = async () => {
      if (cancelled || !target) return;
      if (!diagramSourceAllowed(source, engine)) {
        setState('error');
        return;
      }
      let scratch: HTMLDivElement | undefined;
      try {
        const [{ default: mermaid }, { default: purify }] = await Promise.all([import('mermaid'), import('dompurify')]);
        await runExclusive(mermaid, async () => {
          if (cancelled) return;
          scratch = document.createElement('div');
          scratch.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:1000px';
          target.append(scratch);
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            htmlLabels: true,
            dompurifyConfig: diagramLabelPolicy,
            maxTextSize: researchLimits.block,
            maxEdges: 256,
            suppressErrorRendering: true,
            look: 'classic',
            theme: 'base',
            fontFamily: 'system-ui, sans-serif',
            themeVariables: {
              darkMode: mode === 'dark',
              primaryColor: theme.palette.background.paper,
              primaryTextColor: theme.palette.text.primary,
              primaryBorderColor: theme.palette.text.secondary,
              secondaryColor: theme.palette.background.default,
              tertiaryColor: theme.palette.background.paper,
              lineColor: theme.palette.text.secondary,
              textColor: theme.palette.text.primary,
              fontFamily: 'system-ui, sans-serif',
              fontSize: '16px',
            },
            flowchart: { htmlLabels: true },
            secure: [
              'securityLevel',
              'startOnLoad',
              'maxTextSize',
              'maxEdges',
              'htmlLabels',
              'dompurifyConfig',
              'theme',
              'look',
              'fontFamily',
              'themeCSS',
              'themeVariables',
            ],
          });
          const result = await mermaid.render(id, source, scratch);
          const renderedPicture = diagramImage(result.svg, purify);
          if (!cancelled) {
            setPicture(renderedPicture);
            setState('ready');
          }
        });
      } catch {
        if (!cancelled) setState('error');
      } finally {
        scratch?.remove();
      }
    };
    void run();
    return () => {
      cancelled = true;
      target?.replaceChildren();
    };
  }, [source, engine, id, theme, mode]);
  return (
    <figure className="prism-research__diagram">
      {state !== 'ready' && <p role="status">{state === 'error' ? labels.invalid : labels.loading}</p>}
      <div ref={container} aria-hidden="true" />
      {picture && (
        <img
          className="prism-research__diagram-image"
          src={picture.src}
          alt={picture.description}
          onError={() => setState('error')}
        />
      )}
      <details open={state === 'error'}>
        <summary>
          {labels.source} · {engine}
        </summary>
        <pre>{source}</pre>
      </details>
    </figure>
  );
}
