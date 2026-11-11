/**
 * Isolated Diagram Renderer for Mermaid and ELK Layouts
 */

import { escapeHtml } from '../katex/render-math.js';
import { parseMermaidDirectives } from './directives.js';

export class DiagramRenderer {
  render(code: string, diagramIndex: number = 0, filePath?: string): string {
    return renderDiagramHtml(code, diagramIndex, filePath);
  }
}

export function renderDiagramHtml(code: string, diagramIndex: number = 0, filePath?: string): string {
  const config = parseMermaidDirectives(code);
  const docSlug = (filePath ?? 'doc').replace(/[^a-zA-Z0-9_-]/g, '-');
  const diagramId = `lumen-diag-${docSlug}-${diagramIndex}`;

  const cleanCode = escapeHtml(code.trim());
  const rendererAttr = config.defaultRenderer ? ` data-renderer="${escapeHtml(config.defaultRenderer)}"` : '';

  return `<figure class="lumen-diagram lumen-diagram-mermaid" data-engine="mermaid"${rendererAttr} id="${diagramId}">
  <div class="lumen-diagram-content" id="${diagramId}-svg">
    <svg class="lumen-diagram-svg" viewBox="0 0 800 400" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Mermaid Diagram">
      <!-- Pre-rendered diagram container -->
    </svg>
  </div>
  <pre class="lumen-diagram-source" style="display:none"><code>${cleanCode}</code></pre>
</figure>`;
}

export const defaultDiagramRenderer = new DiagramRenderer();
