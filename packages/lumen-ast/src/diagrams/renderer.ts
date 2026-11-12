import { runExclusive } from '@omnitron-dev/common';
import { escapeHtml } from '../katex/render-math.js';
import { serializeIslandProps } from '../islands/index.js';

export const DIAGRAM_LIMITS = Object.freeze({ sourceBytes: 64 * 1024, svgBytes: 4 * 1024 * 1024, edges: 500, pending: 64 });

export function validateDiagramSource(code: string): void {
  if (typeof code !== 'string' || new TextEncoder().encode(code).length > DIAGRAM_LIMITS.sourceBytes) {
    throw new RangeError(`Diagram source exceeds ${DIAGRAM_LIMITS.sourceBytes} UTF-8 bytes`);
  }
}

/** SSR retains the complete source; the registered MermaidDiagram island renders it. */
export function renderDiagramHtml(code: string, diagramIndex = 0, filePath = 'doc'): string {
  validateDiagramSource(code);
  if (!Number.isSafeInteger(diagramIndex) || diagramIndex < 0) throw new RangeError('Invalid diagram index');
  const docSlug = filePath.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 200);
  const id = `lumen-diag-${docSlug}-${diagramIndex}`;
  return `<figure class="lumen-diagram lumen-diagram-mermaid" id="${id}" data-lumen-island="${id}" data-component="MermaidDiagram" data-hydrate="visible" data-props="${escapeHtml(serializeIslandProps({ code }))}"><pre class="lumen-diagram-source" tabindex="0"><code>${escapeHtml(code)}</code></pre></figure>`;
}

// Bound this consumer's pending work. Serialization itself is shared with Prism
// on the actual engine instance; Mermaid's queue does not protect initialize().
let pending = 0;

export interface DiagramRenderOptions {
  theme?: 'light' | 'dark';
  /** Trusted host theme values; document directives cannot override them. */
  colors?: { surface: string; foreground: string; muted: string; accent: string; border: string };
  fontFamily?: string;
  signal?: AbortSignal;
}

/** Actual Mermaid/ELK rendering requires a browser DOM. No simulated geometry. */
export async function renderDiagramSvg(code: string, id: string, options: DiagramRenderOptions = {}): Promise<string> {
  validateDiagramSource(code);
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,200}$/.test(id)) throw new Error('Invalid diagram render ID');
  if (typeof document === 'undefined') throw new Error('Mermaid rendering requires a browser DOM');
  if (pending >= DIAGRAM_LIMITS.pending) throw new Error('Diagram rendering queue is full');
  pending += 1;
  try {
    options.signal?.throwIfAborted();
    const { default: mermaid } = await import('mermaid');
    return await runExclusive(mermaid, async () => {
      options.signal?.throwIfAborted();
      const colors = options.colors;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: colors ? 'base' : options.theme === 'dark' ? 'dark' : 'default',
        ...(colors ? { themeVariables: {
          darkMode: options.theme === 'dark',
          background: colors.surface, mainBkg: colors.surface,
          primaryColor: colors.surface, primaryTextColor: colors.foreground, primaryBorderColor: colors.border,
          secondaryColor: colors.surface, tertiaryColor: colors.surface,
          textColor: colors.foreground, lineColor: colors.muted,
          clusterBkg: colors.surface, clusterBorder: colors.border,
          edgeLabelBackground: colors.surface, actorBkg: colors.surface,
          actorBorder: colors.border, actorTextColor: colors.foreground,
          signalColor: colors.muted, signalTextColor: colors.foreground,
          noteBkgColor: colors.surface, noteTextColor: colors.foreground, noteBorderColor: colors.border,
          labelBoxBkgColor: colors.surface, labelBoxBorderColor: colors.border, labelTextColor: colors.foreground,
          activationBkgColor: colors.accent, activationBorderColor: colors.border,
        } } : {}),
        // Mermaid's SVG-text renderer prints entity codes literally (#7015).
        // Let its label renderer decode them before measuring, while admitting
        // only text formatting: document HTML cannot add resources or actions.
        htmlLabels: true,
        dompurifyConfig: {
          ALLOWED_TAGS: ['p', 'br', 'b', 'i', 'em', 'strong', 'code', 'del', 's', 'sub', 'sup'],
          ALLOWED_ATTR: [],
          // DOMPurify admits these independently of ALLOWED_ATTR. In particular,
          // author data attributes must never enter the shell's island discovery.
          ALLOW_DATA_ATTR: false,
          ALLOW_ARIA_ATTR: false,
        },
        fontFamily: options.fontFamily ?? 'system-ui, sans-serif',
        // The measurement DOM lives outside the document; keep these metrics
        // when the resulting inline SVG enters article paragraph/code styles.
        themeCSS: `
          .node, .cluster, .node rect, .node polygon, .node circle, .cluster rect { filter: none !important; }
          foreignObject p { font: inherit; line-height: inherit; margin: 0; }
          foreignObject code { font: inherit; font-family: monospace; padding: 0; color: inherit; background: none; border-radius: 0; }
        `,
        maxTextSize: DIAGRAM_LIMITS.sourceBytes,
        maxEdges: DIAGRAM_LIMITS.edges,
        deterministicIds: true,
        deterministicIDSeed: id,
        // Document directives may choose layout, but cannot relax these boundaries.
        secure: ['secure', 'securityLevel', 'startOnLoad', 'suppressErrorRendering', 'maxTextSize', 'maxEdges', 'htmlLabels', 'dompurifyConfig', 'themeCSS', 'theme', 'themeVariables', 'fontFamily'],
      });
      const { svg } = await mermaid.render(id, code);
      options.signal?.throwIfAborted();
      if (new TextEncoder().encode(svg).length > DIAGRAM_LIMITS.svgBytes) throw new Error('Diagram SVG exceeds the output limit');
      return svg;
    });
  } finally {
    pending -= 1;
  }
}
