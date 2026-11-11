/**
 * Mermaid Directive & ELK Layout Configuration Parser
 */

export interface MermaidConfig {
  diagramType: string;
  defaultRenderer?: 'elk' | 'dagre' | string;
  initJson?: Record<string, unknown>;
}

export function parseMermaidDirectives(code: string): MermaidConfig {
  let defaultRenderer: string | undefined;
  let initJson: Record<string, unknown> | undefined;

  // Directive: %%{init: {"flowchart": {"defaultRenderer": "elk"}} }%%
  const initMatch = code.match(/%%\s*\{init:\s*(\{.+?\})\s*\}\s*%%/s);
  if (initMatch && initMatch[1]) {
    try {
      initJson = JSON.parse(initMatch[1]);
      const flowchartConfig = initJson?.['flowchart'] as Record<string, unknown> | undefined;
      if (flowchartConfig && typeof flowchartConfig['defaultRenderer'] === 'string') {
        defaultRenderer = flowchartConfig['defaultRenderer'];
      }
    } catch {
      if (/defaultRenderer["']?\s*:\s*["']elk["']/.test(initMatch[1])) {
        defaultRenderer = 'elk';
      }
    }
  }

  // Detect diagram type from first non-comment line
  const firstCodeLine =
    code
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('%%') && !l.startsWith('---')) ?? '';

  let diagramType = 'flowchart';
  if (/^sequenceDiagram\b/.test(firstCodeLine)) diagramType = 'sequence';
  else if (/^stateDiagram(-v2)?\b/.test(firstCodeLine)) diagramType = 'state';
  else if (/^classDiagram\b/.test(firstCodeLine)) diagramType = 'class';
  else if (/^gitGraph\b/.test(firstCodeLine)) diagramType = 'gitGraph';
  else if (/^graph\b/.test(firstCodeLine)) diagramType = 'graph';
  else if (/^flowchart\b/.test(firstCodeLine)) diagramType = 'flowchart';

  return { diagramType, defaultRenderer, initJson };
}
