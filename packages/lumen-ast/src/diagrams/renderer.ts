/**
 * Deterministic Build-Time SVG Diagram Layout & Geometry Engine + Bounded Worker Pool
 * Supports: flowchart/graph (TD, TB, LR, RL, BT), sequenceDiagram, stateDiagram(-v2), and ELK layouts.
 */

import { escapeHtml } from '../katex/render-math.js';
import { parseMermaidDirectives } from './directives.js';

type NodeShape = 'rect' | 'round' | 'diamond' | 'circle' | 'state-point';
type FlowDirection = 'TD' | 'TB' | 'BT' | 'LR' | 'RL';
type EdgeStyle = 'solid' | 'dashed' | 'thick';

interface DiagramNode {
  id: string;
  label: string;
  shape: NodeShape;
  subgraph?: string;
  width: number;
  height: number;
  rank: number;
  x: number;
  y: number;
}

interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
  style: EdgeStyle;
  arrow: boolean;
}

interface SubgraphGroup {
  id: string;
  title: string;
  nodeIds: string[];
}

interface ParsedGraph {
  diagramType: string;
  direction: FlowDirection;
  isElk: boolean;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  subgraphs: SubgraphGroup[];
}

function unquoteLabel(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function computeNodeDimensions(label: string, shape: NodeShape): { width: number; height: number } {
  if (shape === 'state-point') {
    return { width: 20, height: 20 };
  }
  const textLen = Math.max(2, label.length);
  const baseWidth = Math.max(92, Math.min(280, Math.round(textLen * 7.6 + 32)));
  if (shape === 'diamond') {
    return { width: Math.round(baseWidth * 1.25), height: 56 };
  }
  if (shape === 'circle') {
    const diameter = Math.max(52, Math.min(140, Math.round(textLen * 7 + 28)));
    return { width: diameter, height: diameter };
  }
  return { width: baseWidth, height: 42 };
}

function parseNodeSpec(
  rawToken: string,
  isTarget: boolean,
  stateCounter: { start: number; end: number }
): { id: string; label?: string; shape?: NodeShape } | null {
  const trimmed = rawToken.trim();
  if (!trimmed) return null;

  if (trimmed === '[*]') {
    if (isTarget) {
      stateCounter.end += 1;
      return { id: `__state_end_${stateCounter.end}__`, label: '', shape: 'state-point' };
    }
    if (stateCounter.start === 0) {
      stateCounter.start = 1;
    }
    return { id: `__state_start_${stateCounter.start}__`, label: '', shape: 'state-point' };
  }

  // Circle: ID((label))
  const circleMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*\(\(([\s\S]+)\)\)$/);
  if (circleMatch) {
    const id = circleMatch[1] ?? trimmed;
    const label = unquoteLabel(circleMatch[2] ?? id);
    return { id, label, shape: 'circle' };
  }

  // Diamond: ID{label}
  const diamondMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*\{([\s\S]+)\}$/);
  if (diamondMatch) {
    const id = diamondMatch[1] ?? trimmed;
    const label = unquoteLabel(diamondMatch[2] ?? id);
    return { id, label, shape: 'diamond' };
  }

  // Stadium / Round: ID([label]) or ID(label)
  const roundMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*\(([\s\S]+)\)$/);
  if (roundMatch) {
    const id = roundMatch[1] ?? trimmed;
    let inner = roundMatch[2] ?? id;
    if (inner.startsWith('[') && inner.endsWith(']') && inner.length >= 2) {
      inner = inner.slice(1, -1);
    }
    const label = unquoteLabel(inner);
    return { id, label, shape: 'round' };
  }

  // Rect: ID[label]
  const rectMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*\[([\s\S]+)\]$/);
  if (rectMatch) {
    const id = rectMatch[1] ?? trimmed;
    const label = unquoteLabel(rectMatch[2] ?? id);
    return { id, label, shape: 'rect' };
  }

  // Bare identifier
  const bareMatch = trimmed.match(/^([A-Za-z0-9_.-]+)$/);
  if (bareMatch) {
    return { id: bareMatch[1] ?? trimmed };
  }

  // Fallback sanitized token for partial/broken syntax
  const fallbackId = trimmed.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 48);
  if (!fallbackId) return null;
  return { id: fallbackId, label: unquoteLabel(trimmed).slice(0, 64), shape: 'rect' };
}

interface EdgeSeparatorMatch {
  index: number;
  length: number;
  style: EdgeStyle;
  arrow: boolean;
  label?: string;
}

const ARROW_PATTERNS: Array<{ regex: RegExp; style: EdgeStyle; arrow: boolean; labelGroup?: number }> = [
  { regex: /^--\s+([^-\n]+?)\s+-->/, style: 'solid', arrow: true, labelGroup: 1 },
  { regex: /^-\.\s+([^.\n]+?)\s+\.->/, style: 'dashed', arrow: true, labelGroup: 1 },
  { regex: /^==\s+([^=\n]+?)\s+==>/, style: 'thick', arrow: true, labelGroup: 1 },
  { regex: /^-->\|([^|]*)\|/, style: 'solid', arrow: true, labelGroup: 1 },
  { regex: /^-\.->\|([^|]*)\|/, style: 'dashed', arrow: true, labelGroup: 1 },
  { regex: /^==>\|([^|]*)\|/, style: 'thick', arrow: true, labelGroup: 1 },
  { regex: /^---\|([^|]*)\|/, style: 'solid', arrow: false, labelGroup: 1 },
  { regex: /^---+>/, style: 'solid', arrow: true },
  { regex: /^-\.+->/, style: 'dashed', arrow: true },
  { regex: /^\.\.+>/, style: 'dashed', arrow: true },
  { regex: /^==+>/, style: 'thick', arrow: true },
  { regex: /^-->>/, style: 'dashed', arrow: true },
  { regex: /^->>/, style: 'solid', arrow: true },
  { regex: /^-->/, style: 'solid', arrow: true },
  { regex: /^->/, style: 'solid', arrow: true },
  { regex: /^---/, style: 'solid', arrow: false },
];

function findNextArrowOutsideDelims(line: string, startIndex: number): EdgeSeparatorMatch | null {
  let inSingle = false;
  let inDouble = false;
  let squareDepth = 0;
  let roundDepth = 0;
  let curlyDepth = 0;

  for (let i = startIndex; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (!inDouble && ch === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (inSingle || inDouble) continue;

    if (ch === '[') {
      // Allow [*] at start of token
      if (line.slice(i, i + 3) === '[*]') {
        i += 2;
        continue;
      }
      squareDepth += 1;
      continue;
    }
    if (ch === ']') {
      squareDepth = Math.max(0, squareDepth - 1);
      continue;
    }
    if (ch === '(') {
      roundDepth += 1;
      continue;
    }
    if (ch === ')') {
      roundDepth = Math.max(0, roundDepth - 1);
      continue;
    }
    if (ch === '{') {
      curlyDepth += 1;
      continue;
    }
    if (ch === '}') {
      curlyDepth = Math.max(0, curlyDepth - 1);
      continue;
    }

    if (squareDepth > 0 || roundDepth > 0 || curlyDepth > 0) {
      continue;
    }

    if (ch === '-' || ch === '=' || ch === '.') {
      const slice = line.slice(i);
      for (const pat of ARROW_PATTERNS) {
        const m = pat.regex.exec(slice);
        if (m) {
          const rawLabel = pat.labelGroup !== undefined ? m[pat.labelGroup] : undefined;
          return {
            index: i,
            length: m[0].length,
            style: pat.style,
            arrow: pat.arrow,
            label: rawLabel ? unquoteLabel(rawLabel) : undefined,
          };
        }
      }
    }
  }

  return null;
}

function stripDirectivesAndComments(code: string): string[] {
  const withoutInit = code.replace(/%%\s*\{[\s\S]*?\}\s*%%/g, '');
  return withoutInit
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('%%'));
}

function parseDiagramGraph(code: string): ParsedGraph {
  const config = parseMermaidDirectives(code);
  const isElk = config.defaultRenderer === 'elk';
  const lines = stripDirectivesAndComments(code);

  const nodeMap = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];
  const subgraphs: SubgraphGroup[] = [];
  let activeSubgraph: SubgraphGroup | null = null;
  const stateCounter = { start: 0, end: 0 };

  const upsertNode = (id: string, label?: string, shape?: NodeShape): DiagramNode => {
    const existing = nodeMap.get(id);
    if (existing) {
      if (label !== undefined && (existing.label === existing.id || existing.label === '')) {
        existing.label = label;
      }
      if (shape !== undefined && existing.shape === 'rect') {
        existing.shape = shape;
      }
      const dims = computeNodeDimensions(existing.label, existing.shape);
      existing.width = dims.width;
      existing.height = dims.height;
      return existing;
    }

    const finalShape: NodeShape = shape ?? 'rect';
    const finalLabel = label !== undefined ? label : id;
    const dims = computeNodeDimensions(finalLabel, finalShape);
    const created: DiagramNode = {
      id,
      label: finalLabel,
      shape: finalShape,
      subgraph: activeSubgraph?.id,
      width: dims.width,
      height: dims.height,
      rank: 0,
      x: 0,
      y: 0,
    };
    nodeMap.set(id, created);
    if (activeSubgraph) {
      activeSubgraph.nodeIds.push(id);
    }
    return created;
  };

  let direction: FlowDirection = 'TD';
  const headerLine = lines[0] ?? '';
  const dirMatch = headerLine.match(/^(?:flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/i);
  if (dirMatch && dirMatch[1]) {
    direction = dirMatch[1].toUpperCase() as FlowDirection;
  }

  if (config.diagramType === 'sequence') {
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (/^(?:autonumber|loop|alt|else|opt|par|end|note|activate|deactivate)\b/i.test(line)) {
        continue;
      }

      const partMatch = line.match(/^(?:participant|actor)\s+([A-Za-z0-9_.-]+)(?:\s+as\s+(.+))?$/i);
      if (partMatch && partMatch[1]) {
        const id = partMatch[1];
        const label = partMatch[2] ? unquoteLabel(partMatch[2]) : id;
        upsertNode(id, label, 'rect');
        continue;
      }

      const msgMatch = line.match(/^([A-Za-z0-9_.-]+)\s*(-->>|->>|-->|->)\s*([+-]?[A-Za-z0-9_.-]+)\s*(?::\s*(.*))?$/);
      if (msgMatch && msgMatch[1] && msgMatch[2] && msgMatch[3]) {
        const fromId = msgMatch[1];
        const arrowOp = msgMatch[2];
        const toId = msgMatch[3].replace(/^[+-]/, '');
        const msgLabel = msgMatch[4]?.trim();

        upsertNode(fromId);
        upsertNode(toId);
        edges.push({
          from: fromId,
          to: toId,
          label: msgLabel || undefined,
          style: arrowOp.startsWith('--') ? 'dashed' : 'solid',
          arrow: true,
        });
      }
    }

    return {
      diagramType: 'sequence',
      direction: 'LR',
      isElk,
      nodes: [...nodeMap.values()],
      edges,
      subgraphs,
    };
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (i === 0 && /^(?:flowchart|graph|stateDiagram(?:-v2)?|classDiagram|gitGraph)\b/i.test(line)) {
      continue;
    }

    if (/^subgraph\b/i.test(line)) {
      const rest = line.replace(/^subgraph\s*/i, '').trim();
      const sgBracket = rest.match(/^([A-Za-z0-9_.-]+)\s*\[(.+)\]$/);
      const sgId = sgBracket?.[1] ?? (rest.replace(/[^A-Za-z0-9_.-]/g, '_') || `sg_${subgraphs.length + 1}`);
      const sgTitle = sgBracket?.[2] ? unquoteLabel(sgBracket[2]) : unquoteLabel(rest || sgId);
      activeSubgraph = { id: sgId, title: sgTitle, nodeIds: [] };
      subgraphs.push(activeSubgraph);
      continue;
    }

    if (/^end\b/i.test(line)) {
      activeSubgraph = null;
      continue;
    }

    const dirInline = line.match(/^direction\s+(TD|TB|BT|LR|RL)\b/i);
    if (dirInline && dirInline[1]) {
      direction = dirInline[1].toUpperCase() as FlowDirection;
      continue;
    }

    // State alias: state "Description" as S1
    const stateAlias = line.match(/^state\s+"([^"]+)"\s+as\s+([A-Za-z0-9_.-]+)$/i);
    if (stateAlias && stateAlias[1] && stateAlias[2]) {
      upsertNode(stateAlias[2], stateAlias[1], 'round');
      continue;
    }

    if (/^(?:style|classDef|class|click|linkStyle)\b/i.test(line)) {
      continue;
    }

    // Check for one or more chained arrows on this line
    const firstArrow = findNextArrowOutsideDelims(line, 0);
    if (firstArrow) {
      let cursor = 0;
      let currentArrow: EdgeSeparatorMatch | null = firstArrow;
      const segments: string[] = [];
      const arrowInfos: EdgeSeparatorMatch[] = [];

      while (currentArrow !== null) {
        segments.push(line.slice(cursor, currentArrow.index).trim());
        arrowInfos.push(currentArrow);
        cursor = currentArrow.index + currentArrow.length;
        currentArrow = findNextArrowOutsideDelims(line, cursor);
      }

      let tailSegment = line.slice(cursor).trim();
      let trailingLabel: string | undefined;
      // State transition trailing `: label` (outside brackets/quotes)
      const colonIdx = tailSegment.indexOf(':');
      if (colonIdx > 0 && !tailSegment.includes('[') && !tailSegment.includes('"')) {
        trailingLabel = tailSegment.slice(colonIdx + 1).trim();
        tailSegment = tailSegment.slice(0, colonIdx).trim();
      }
      segments.push(tailSegment);

      for (let s = 0; s < arrowInfos.length; s++) {
        const leftRaw = segments[s] ?? '';
        const rightRaw = segments[s + 1] ?? '';
        const arrowInfo = arrowInfos[s]!;

        const leftSpec = parseNodeSpec(leftRaw, false, stateCounter);
        const rightSpec = parseNodeSpec(rightRaw, true, stateCounter);
        if (leftSpec && rightSpec) {
          const defaultShape: NodeShape | undefined = config.diagramType === 'state' ? 'round' : undefined;
          upsertNode(leftSpec.id, leftSpec.label, leftSpec.shape ?? defaultShape);
          upsertNode(rightSpec.id, rightSpec.label, rightSpec.shape ?? defaultShape);
          edges.push({
            from: leftSpec.id,
            to: rightSpec.id,
            label: arrowInfo.label ?? (s === arrowInfos.length - 1 ? trailingLabel : undefined),
            style: arrowInfo.style,
            arrow: arrowInfo.arrow,
          });
        }
      }
      continue;
    }

    // Standalone node declaration
    const singleSpec = parseNodeSpec(line.replace(/;$/, ''), false, stateCounter);
    if (singleSpec && singleSpec.label !== undefined) {
      upsertNode(singleSpec.id, singleSpec.label, singleSpec.shape);
    }
  }

  return {
    diagramType: config.diagramType,
    direction,
    isElk,
    nodes: [...nodeMap.values()],
    edges,
    subgraphs,
  };
}

function renderSequenceSvg(graph: ParsedGraph, diagramId: string): { svg: string; width: number; height: number } {
  const nodes = graph.nodes;
  const edges = graph.edges;
  const paddingX = 40;
  const topY = 24;
  const colGap = 170;
  const stepHeight = 52;

  let curX = paddingX;
  for (const node of nodes) {
    node.x = curX;
    node.y = topY;
    curX += Math.max(node.width + 48, colGap);
  }

  const totalWidth = Math.max(320, curX - 48 + paddingX);
  const lifelineBottom = topY + 42 + Math.max(1, edges.length) * stepHeight + 28;
  const totalHeight = Math.max(180, lifelineBottom + 24);

  const markerId = `${diagramId}-arrow`;

  const lifelinesSvg = nodes
    .map((n) => {
      const cx = Math.round(n.x + n.width / 2);
      return `<line class="lumen-lifeline" x1="${cx}" y1="${n.y + n.height}" x2="${cx}" y2="${lifelineBottom}" stroke="var(--lumen-diag-border, #94a3b8)" stroke-dasharray="4,4" stroke-width="1.2" />`;
    })
    .join('');

  const nodeLookup = new Map(nodes.map((n) => [n.id, n]));
  const edgesSvg = edges
    .map((edge, idx) => {
      const fromNode = nodeLookup.get(edge.from);
      const toNode = nodeLookup.get(edge.to);
      if (!fromNode || !toNode) return '';

      const x1 = Math.round(fromNode.x + fromNode.width / 2);
      const x2 = Math.round(toNode.x + toNode.width / 2);
      const y = topY + 42 + (idx + 1) * stepHeight;
      const dash = edge.style === 'dashed' ? ' stroke-dasharray="5,4"' : '';

      const pathD =
        x1 === x2
          ? `M ${x1} ${y - 8} L ${x1 + 36} ${y - 8} L ${x1 + 36} ${y + 12} L ${x1} ${y + 12}`
          : `M ${x1} ${y} L ${x2} ${y}`;

      const labelX = x1 === x2 ? x1 + 42 : Math.round((x1 + x2) / 2);
      const labelAnchor = x1 === x2 ? 'start' : 'middle';
      const labelHtml = edge.label
        ? `<text class="lumen-edge-label" x="${labelX}" y="${y - 8}" text-anchor="${labelAnchor}" font-size="12" fill="var(--lumen-diag-fg, #0f172a)">${escapeHtml(edge.label)}</text>`
        : '';

      return `<path class="lumen-edge-path" d="${pathD}" fill="none" stroke="var(--lumen-diag-edge, #475569)" stroke-width="1.5"${dash} marker-end="url(#${markerId})" />${labelHtml}`;
    })
    .join('');

  const nodesSvg = nodes
    .map((n) => {
      const cx = Math.round(n.width / 2);
      const cy = Math.round(n.height / 2 + 4);
      return `<g class="lumen-node" data-node-id="${escapeHtml(n.id)}" transform="translate(${n.x}, ${n.y})"><rect x="0" y="0" width="${n.width}" height="${n.height}" rx="6" ry="6" fill="var(--lumen-diag-node-fill, #f8fafc)" stroke="var(--lumen-diag-border, #64748b)" stroke-width="1.5" /><text x="${cx}" y="${cy}" text-anchor="middle" font-size="13" font-family="system-ui, -apple-system, sans-serif" fill="var(--lumen-diag-fg, #0f172a)">${escapeHtml(n.label)}</text></g>`;
    })
    .join('');

  const svg = `<svg class="lumen-diagram-svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Mermaid Diagram">
      <defs>
        <marker id="${markerId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--lumen-diag-edge, #475569)" />
        </marker>
      </defs>
      <g class="lumen-diagram-lifelines">${lifelinesSvg}</g>
      <g class="lumen-diagram-edges">${edgesSvg}</g>
      <g class="lumen-diagram-nodes">${nodesSvg}</g>
    </svg>`;

  return { svg, width: totalWidth, height: totalHeight };
}

function renderLayeredSvg(graph: ParsedGraph, diagramId: string): { svg: string; width: number; height: number } {
  const nodes = graph.nodes;
  const edges = graph.edges;
  const markerId = `${diagramId}-arrow`;

  if (nodes.length === 0) {
    const emptyW = 320;
    const emptyH = 120;
    const svg = `<svg class="lumen-diagram-svg" viewBox="0 0 ${emptyW} ${emptyH}" width="${emptyW}" height="${emptyH}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Mermaid Diagram">
      <defs>
        <marker id="${markerId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--lumen-diag-edge, #475569)" />
        </marker>
      </defs>
      <g class="lumen-diagram-edges"></g>
      <g class="lumen-diagram-nodes"></g>
    </svg>`;
    return { svg, width: emptyW, height: emptyH };
  }

  // Cycle-safe BFS rank assignment
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const n of nodes) {
    adj.set(n.id, []);
    inDegree.set(n.id, 0);
  }
  for (const e of edges) {
    if (e.from !== e.to && adj.has(e.from) && adj.has(e.to)) {
      adj.get(e.from)!.push(e.to);
      inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    }
  }

  const rankMap = new Map<string, number>();
  const visited = new Set<string>();
  const queue: string[] = [];

  for (const n of nodes) {
    if ((inDegree.get(n.id) ?? 0) === 0) {
      rankMap.set(n.id, 0);
      visited.add(n.id);
      queue.push(n.id);
    }
  }

  // Ensure pure cycles still start at the first declared node
  if (queue.length === 0 && nodes[0]) {
    rankMap.set(nodes[0].id, 0);
    visited.add(nodes[0].id);
    queue.push(nodes[0].id);
  }

  let head = 0;
  while (head < queue.length) {
    const curr = queue[head++]!;
    const currRank = rankMap.get(curr) ?? 0;
    const neighbors = adj.get(curr) ?? [];
    for (const next of neighbors) {
      if (!visited.has(next)) {
        visited.add(next);
        rankMap.set(next, currRank + 1);
        queue.push(next);
      } else {
        // Acyclic forward refinement without revisiting cycles
        const existingRank = rankMap.get(next) ?? 0;
        if (existingRank < currRank + 1 && currRank + 1 < nodes.length) {
          // Only bump if next does not already precede curr
          if (existingRank > currRank) {
            rankMap.set(next, currRank + 1);
          }
        }
      }
    }
  }

  for (const n of nodes) {
    if (!visited.has(n.id)) {
      rankMap.set(n.id, 0);
    }
    n.rank = rankMap.get(n.id) ?? 0;
  }

  const layers = new Map<number, DiagramNode[]>();
  let maxRank = 0;
  for (const n of nodes) {
    if (n.rank > maxRank) maxRank = n.rank;
    const bucket = layers.get(n.rank);
    if (bucket) bucket.push(n);
    else layers.set(n.rank, [n]);
  }

  const isHorizontal = graph.direction === 'LR' || graph.direction === 'RL';
  const isReversed = graph.direction === 'BT' || graph.direction === 'RL';
  const rankGap = graph.isElk ? 84 : 68;
  const siblingGap = graph.isElk ? 44 : 34;
  const padding = 36;

  let maxCrossSpan = 0;
  const layerMainSizes: number[] = [];

  for (let r = 0; r <= maxRank; r++) {
    const bucket = layers.get(r) ?? [];
    let crossSpan = 0;
    let mainMax = 0;
    for (let i = 0; i < bucket.length; i++) {
      const node = bucket[i]!;
      const mainSize = isHorizontal ? node.width : node.height;
      const crossSize = isHorizontal ? node.height : node.width;
      if (mainSize > mainMax) mainMax = mainSize;
      crossSpan += crossSize + (i > 0 ? siblingGap : 0);
    }
    layerMainSizes.push(mainMax);
    if (crossSpan > maxCrossSpan) maxCrossSpan = crossSpan;
  }

  let mainCursor = padding;
  const orderedRanks: number[] = [];
  for (let r = 0; r <= maxRank; r++) {
    orderedRanks.push(isReversed ? maxRank - r : r);
  }

  for (const r of orderedRanks) {
    const bucket = layers.get(r) ?? [];
    const mainMax = layerMainSizes[r] ?? 42;
    let crossSpan = 0;
    for (let i = 0; i < bucket.length; i++) {
      const node = bucket[i]!;
      crossSpan += (isHorizontal ? node.height : node.width) + (i > 0 ? siblingGap : 0);
    }

    let crossCursor = padding + Math.max(0, Math.round((maxCrossSpan - crossSpan) / 2));
    for (const node of bucket) {
      if (isHorizontal) {
        node.x = mainCursor + Math.round((mainMax - node.width) / 2);
        node.y = crossCursor;
        crossCursor += node.height + siblingGap;
      } else {
        node.x = crossCursor;
        node.y = mainCursor + Math.round((mainMax - node.height) / 2);
        crossCursor += node.width + siblingGap;
      }
    }

    mainCursor += mainMax + rankGap;
  }

  const totalMain = Math.max(180, mainCursor - rankGap + padding);
  const totalCross = Math.max(180, maxCrossSpan + padding * 2);
  const totalWidth = isHorizontal ? totalMain : totalCross;
  const totalHeight = isHorizontal ? totalCross : totalMain;

  const nodeLookup = new Map(nodes.map((n) => [n.id, n]));

  const subgraphsSvg = graph.subgraphs
    .map((sg) => {
      const members = sg.nodeIds.map((id) => nodeLookup.get(id)).filter((n): n is DiagramNode => Boolean(n));
      if (members.length === 0) return '';
      const minX = Math.min(...members.map((m) => m.x)) - 16;
      const minY = Math.min(...members.map((m) => m.y)) - 26;
      const maxX = Math.max(...members.map((m) => m.x + m.width)) + 16;
      const maxY = Math.max(...members.map((m) => m.y + m.height)) + 14;
      const sgW = Math.max(80, maxX - minX);
      const sgH = Math.max(60, maxY - minY);
      return `<g class="lumen-subgraph" data-subgraph="${escapeHtml(sg.id)}"><rect x="${minX}" y="${minY}" width="${sgW}" height="${sgH}" rx="8" ry="8" fill="var(--lumen-diag-subgraph-bg, rgba(148,163,184,0.08))" stroke="var(--lumen-diag-border, #94a3b8)" stroke-dasharray="4,3" stroke-width="1.2" /><text x="${minX + 10}" y="${minY + 16}" font-size="11" font-weight="600" fill="var(--lumen-diag-fg, #334155)">${escapeHtml(sg.title)}</text></g>`;
    })
    .join('');

  const edgesSvg = edges
    .map((edge) => {
      const from = nodeLookup.get(edge.from);
      const to = nodeLookup.get(edge.to);
      if (!from || !to) return '';

      const fcx = from.x + from.width / 2;
      const fcy = from.y + from.height / 2;
      const tcx = to.x + to.width / 2;
      const tcy = to.y + to.height / 2;

      let sx = Math.round(fcx);
      let sy = Math.round(fcy);
      let tx = Math.round(tcx);
      let ty = Math.round(tcy);

      if (isHorizontal) {
        if (fcx <= tcx) {
          sx = from.x + from.width;
          tx = to.x;
        } else {
          sx = from.x;
          tx = to.x + to.width;
        }
      } else if (fcy <= tcy) {
        sy = from.y + from.height;
        ty = to.y;
      } else {
        sy = from.y;
        ty = to.y + to.height;
      }

      let pathD: string;
      if (from.id === to.id) {
        pathD = `M ${sx} ${sy} L ${sx + 28} ${sy} L ${sx + 28} ${sy + 28} L ${tx} ${ty}`;
      } else if (graph.isElk) {
        if (isHorizontal) {
          const midX = Math.round((sx + tx) / 2);
          pathD = `M ${sx} ${sy} L ${midX} ${sy} L ${midX} ${ty} L ${tx} ${ty}`;
        } else {
          const midY = Math.round((sy + ty) / 2);
          pathD = `M ${sx} ${sy} L ${sx} ${midY} L ${tx} ${midY} L ${tx} ${ty}`;
        }
      } else {
        pathD = `M ${sx} ${sy} L ${tx} ${ty}`;
      }

      const strokeWidth = edge.style === 'thick' ? '2.5' : '1.6';
      const dash = edge.style === 'dashed' ? ' stroke-dasharray="5,4"' : '';
      const markerAttr = edge.arrow ? ` marker-end="url(#${markerId})"` : '';

      const midX = Math.round((sx + tx) / 2);
      const midY = Math.round((sy + ty) / 2);
      const labelSvg = edge.label
        ? `<text class="lumen-edge-label" x="${midX}" y="${midY - 6}" text-anchor="middle" font-size="11" fill="var(--lumen-diag-fg, #0f172a)">${escapeHtml(edge.label)}</text>`
        : '';

      return `<path class="lumen-edge-path" d="${pathD}" fill="none" stroke="var(--lumen-diag-edge, #475569)" stroke-width="${strokeWidth}"${dash}${markerAttr} />${labelSvg}`;
    })
    .join('');

  const nodesSvg = nodes
    .map((n) => {
      const cx = Math.round(n.width / 2);
      const cy = Math.round(n.height / 2);

      let shapeSvg: string;
      if (n.shape === 'state-point') {
        const isEnd = n.id.startsWith('__state_end_');
        shapeSvg = isEnd
          ? `<circle cx="${cx}" cy="${cy}" r="9" fill="none" stroke="var(--lumen-diag-fg, #0f172a)" stroke-width="2" /><circle cx="${cx}" cy="${cy}" r="5" fill="var(--lumen-diag-fg, #0f172a)" />`
          : `<circle cx="${cx}" cy="${cy}" r="8" fill="var(--lumen-diag-fg, #0f172a)" />`;
      } else if (n.shape === 'diamond') {
        const pts = `${cx},0 ${n.width},${cy} ${cx},${n.height} 0,${cy}`;
        shapeSvg = `<polygon points="${pts}" fill="var(--lumen-diag-node-fill, #f8fafc)" stroke="var(--lumen-diag-border, #64748b)" stroke-width="1.5" />`;
      } else if (n.shape === 'circle') {
        const r = Math.round(Math.min(n.width, n.height) / 2);
        shapeSvg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="var(--lumen-diag-node-fill, #f8fafc)" stroke="var(--lumen-diag-border, #64748b)" stroke-width="1.5" />`;
      } else {
        const rx = n.shape === 'round' ? 18 : 6;
        shapeSvg = `<rect x="0" y="0" width="${n.width}" height="${n.height}" rx="${rx}" ry="${rx}" fill="var(--lumen-diag-node-fill, #f8fafc)" stroke="var(--lumen-diag-border, #64748b)" stroke-width="1.5" />`;
      }

      const textSvg =
        n.shape === 'state-point'
          ? ''
          : `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="13" font-family="system-ui, -apple-system, sans-serif" fill="var(--lumen-diag-fg, #0f172a)">${escapeHtml(n.label)}</text>`;

      return `<g class="lumen-node" data-node-id="${escapeHtml(n.id)}" data-shape="${n.shape}" transform="translate(${n.x}, ${n.y})">${shapeSvg}${textSvg}</g>`;
    })
    .join('');

  const layoutAttr = graph.isElk ? ' data-layout="elk"' : ' data-layout="layered"';
  const svg = `<svg class="lumen-diagram-svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}"${layoutAttr} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Mermaid Diagram">
      <defs>
        <marker id="${markerId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--lumen-diag-edge, #475569)" />
        </marker>
      </defs>
      ${subgraphsSvg ? `<g class="lumen-diagram-subgraphs">${subgraphsSvg}</g>` : ''}
      <g class="lumen-diagram-edges">${edgesSvg}</g>
      <g class="lumen-diagram-nodes">${nodesSvg}</g>
    </svg>`;

  return { svg, width: totalWidth, height: totalHeight };
}

export class DiagramRenderer {
  render(code: string, diagramIndex: number = 0, filePath?: string): string {
    return renderDiagramHtml(code, diagramIndex, filePath);
  }
}

export function renderDiagramHtml(code: string, diagramIndex: number = 0, filePath?: string): string {
  const safeCode = typeof code === 'string' ? code : '';
  const config = parseMermaidDirectives(safeCode);
  const docSlug = (filePath ?? 'doc').replace(/[^a-zA-Z0-9_-]/g, '-');
  const diagramId = `lumen-diag-${docSlug}-${diagramIndex}`;

  const cleanCode = escapeHtml(safeCode.trim());
  const rendererAttr = config.defaultRenderer ? ` data-renderer="${escapeHtml(config.defaultRenderer)}"` : '';
  const themeVars =
    '--lumen-diag-bg:var(--lumen-surface,#ffffff);--lumen-diag-fg:var(--lumen-fg,#0f172a);--lumen-diag-border:var(--lumen-border,#64748b);--lumen-diag-edge:var(--lumen-muted,#475569);--lumen-diag-node-fill:var(--lumen-node-bg,#f8fafc);';

  const parsed = parseDiagramGraph(safeCode);
  const { svg } =
    parsed.diagramType === 'sequence' ? renderSequenceSvg(parsed, diagramId) : renderLayeredSvg(parsed, diagramId);

  return `<figure class="lumen-diagram lumen-diagram-mermaid" data-engine="mermaid" data-diagram-type="${escapeHtml(config.diagramType)}"${rendererAttr} id="${diagramId}" style="${themeVars}">
  <div class="lumen-diagram-content" id="${diagramId}-svg">
    ${svg}
  </div>
  <pre class="lumen-diagram-source lumen-mermaid-source" style="display:none"><code>${cleanCode}</code></pre>
</figure>`;
}

export interface MermaidWorkerPoolOptions {
  maxWorkers?: number;
  concurrency?: number;
}

export interface MermaidRenderJob {
  code: string;
  diagramIndex?: number;
  filePath?: string;
}

interface QueuedTask {
  job: MermaidRenderJob;
  resolve: (value: string) => void;
  reject: (reason: unknown) => void;
}

/**
 * Bounded async diagram rendering pool with FIFO scheduling and backpressure isolation.
 */
export class MermaidWorkerPool {
  private readonly maxConcurrency: number;
  private activeTasks = 0;
  private closed = false;
  private readonly queue: QueuedTask[] = [];

  constructor(options?: MermaidWorkerPoolOptions) {
    const raw = options?.maxWorkers ?? options?.concurrency ?? 4;
    this.maxConcurrency = Math.max(1, Math.min(32, Math.floor(raw) || 4));
  }

  get activeCount(): number {
    return this.activeTasks;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  get size(): number {
    return this.maxConcurrency;
  }

  render(code: string, diagramIndex: number = 0, filePath?: string): Promise<string> {
    if (this.closed) {
      return Promise.reject(new Error('MermaidWorkerPool has been shut down'));
    }

    return new Promise<string>((resolve, reject) => {
      this.queue.push({
        job: { code, diagramIndex, filePath },
        resolve,
        reject,
      });
      this.drain();
    });
  }

  renderBatch(jobs: MermaidRenderJob[]): Promise<string[]> {
    return Promise.all(jobs.map((j, idx) => this.render(j.code, j.diagramIndex ?? idx, j.filePath)));
  }

  private drain(): void {
    while (this.activeTasks < this.maxConcurrency && this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.activeTasks += 1;

      queueMicrotask(() => {
        try {
          const html = renderDiagramHtml(next.job.code, next.job.diagramIndex ?? 0, next.job.filePath);
          next.resolve(html);
        } catch (err) {
          next.reject(err);
        } finally {
          this.activeTasks -= 1;
          this.drain();
        }
      });
    }
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    while (this.queue.length > 0) {
      const pending = this.queue.shift();
      pending?.reject(new Error('MermaidWorkerPool shut down before task started'));
    }
  }

  async destroy(): Promise<void> {
    await this.shutdown();
  }
}

export const defaultDiagramRenderer = new DiagramRenderer();
