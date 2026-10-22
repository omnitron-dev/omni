'use client';
import { Component, useId, useMemo, type ReactNode, type ComponentType } from 'react';
import katex from 'katex';
import { Accordion, AccordionSummary, AccordionDetails, Box, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { TipTapRenderer, type TipTapNode } from '../tiptap-renderer/index.js';
import { parseResearchMarkdown, researchLimits } from './parse.js';
import { ResearchDiagram } from './diagram.js';
import './research.css';

export interface ResearchWidget {
  version: number;
  render: (props: unknown) => ReactNode;
}
export type ResearchWidgets = Readonly<Record<string, ResearchWidget>>;
export function defineResearchWidget<P>(
  version: number,
  parse: (input: unknown) => P,
  View: ComponentType<P & object>
): ResearchWidget {
  return {
    version,
    render(input) {
      const props = parse(input);
      return <View {...(props as P & object)} />;
    },
  };
}
export interface ResearchLabels {
  metadata: string;
  contents: string;
  source: string;
  unavailable: string;
  invalid: string;
  loading: string;
  diagnostics: string;
}
export const defaultResearchLabels: ResearchLabels = {
  metadata: 'Source metadata',
  contents: 'On this page',
  source: 'Source',
  unavailable: 'This block is not available in this document.',
  invalid: 'This block could not be rendered. Its source is preserved.',
  loading: 'Rendering diagram…',
  diagnostics: 'Document diagnostics',
};
export interface ResearchDocumentProps {
  /** Enables inert Docusaurus heading IDs and namespaced fragment links. */
  sourceProfile?: 'research' | 'docusaurus';
  source: string;
  /** Stable namespace for deep links. A revision identifier belongs to the host's document metadata. */
  documentId?: string;
  widgets?: ResearchWidgets;
  labels?: Partial<ResearchLabels>;
  contents?: boolean;
  className?: string;
  sx?: SxProps<Theme>;
}
class BlockBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
function Formula({ node, labels }: { node: TipTapNode; labels: ResearchLabels }) {
  const tex = String(node.attrs?.tex ?? '');
  try {
    if (tex.length > researchLimits.block) throw new Error('formula_limit');
    const html = katex.renderToString(tex, {
      displayMode: node.type === 'mathBlock',
      trust: false,
      strict: 'error',
      throwOnError: true,
      maxExpand: 1000,
      maxSize: 20,
      output: 'htmlAndMathml',
    });
    return (
      <span
        className={node.type === 'mathBlock' ? 'prism-research__formula-block' : undefined}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  } catch {
    return (
      <code className="prism-research__invalid-math" title={labels.invalid}>
        {tex}
      </code>
    );
  }
}
function Widget({ node, widgets, labels }: { node: TipTapNode; widgets: ResearchWidgets; labels: ResearchLabels }) {
  const d = node.attrs?.descriptor as { type?: unknown; version?: unknown; props?: unknown } | undefined;
  if (!d || typeof d.type !== 'string' || !Object.hasOwn(widgets, d.type) || widgets[d.type]?.version !== d.version)
    return (
      <details className="prism-research__failure">
        <summary>{labels.unavailable}</summary>
        <pre>{JSON.stringify(d)}</pre>
      </details>
    );
  try {
    return widgets[d.type]!.render(d.props);
  } catch {
    return (
      <details className="prism-research__failure">
        <summary>{labels.invalid}</summary>
        <pre>{JSON.stringify(d)}</pre>
      </details>
    );
  }
}
const emptyWidgets: ResearchWidgets = Object.freeze({});
export function ResearchDocument({
  source,
  sourceProfile = 'research',
  documentId,
  widgets = emptyWidgets,
  labels: overrides,
  contents = false,
  className,
  sx,
}: ResearchDocumentProps) {
  const uid = useId();
  const prefix = documentId ?? `research-${uid.replace(/[^\w-]/g, '')}`;
  const labels = { ...defaultResearchLabels, ...overrides };
  const parsed = useMemo(() => {
    try {
      return { data: parseResearchMarkdown(source, prefix, sourceProfile) };
    } catch {
      return { error: true };
    }
  }, [source, prefix, sourceProfile]);
  const nodes = useMemo(() => {
    const failure = (raw: string) => (
      <details className="prism-research__failure" open>
        <summary>{labels.invalid}</summary>
        <pre>{raw}</pre>
      </details>
    );
    const bounded = (render: (node: TipTapNode) => ReactNode) => (props: { node: TipTapNode }) => {
      const raw = String(
        props.node.attrs?.tex ?? props.node.attrs?.code ?? JSON.stringify(props.node.attrs?.descriptor ?? {})
      );
      return (
        <BlockBoundary key={raw} fallback={failure(raw)}>
          {render(props.node)}
        </BlockBoundary>
      );
    };
    return {
      mathInline: ({ node }: { node: TipTapNode }) => <Formula node={node} labels={labels} />,
      mathBlock: ({ node }: { node: TipTapNode }) => <Formula node={node} labels={labels} />,
      diagram: bounded((n) => (
        <ResearchDiagram source={String(n.attrs?.code ?? '')} engine={String(n.attrs?.engine ?? '')} labels={labels} />
      )),
      researchWidget: bounded((n) => <Widget node={n} widgets={widgets} labels={labels} />),
    };
  }, [widgets, labels.invalid, labels.unavailable, labels.loading, labels.source]);
  if (!parsed.data) return <p role="alert">{labels.invalid}</p>;
  return (
    <Box
      className={`prism-research ${className ?? ''}`}
      sx={(theme) => ({ '--prism-research-border': theme.palette.divider })}
    >
      {parsed.data.metadata && (
        <Accordion
          disableGutters
          elevation={0}
          sx={{ mb: 2, border: 1, borderColor: 'divider', '&:before': { display: 'none' } }}
        >
          <AccordionSummary expandIcon={<span aria-hidden="true">＋</span>}>
            <Typography variant="caption" color="text.secondary">
              {labels.metadata} · YAML
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Box
              component="pre"
              sx={{
                m: 0,
                maxHeight: 240,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                fontSize: 12,
              }}
            >
              {parsed.data.metadata.raw}
            </Box>
          </AccordionDetails>
        </Accordion>
      )}
      {contents && parsed.data.headings.length > 0 && (
        <nav className="prism-research__contents" aria-label={labels.contents}>
          <p>{labels.contents}</p>
          <ol>
            {parsed.data.headings.map((h) => (
              <li key={h.id}>
                <a href={`#${h.id}`}>{h.title}</a>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <TipTapRenderer content={parsed.data.doc} nodeRenderers={nodes} inheritRegisteredNodes={false} sx={sx} />
      {parsed.data.diagnostics.length > 0 && (
        <details className="prism-research__diagnostics">
          <summary>
            {labels.diagnostics} · {parsed.data.diagnostics.length}
          </summary>
          <ul>
            {parsed.data.diagnostics.map((d, i) => (
              <li key={i}>
                {d.line}: <code>{d.code}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Box>
  );
}
