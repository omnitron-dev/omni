import type { LumenDocumentAst, LumenNode, LumenTocItem } from '@omnitron-dev/lumen-ast';
import { CorpusGraph } from './graph.js';
import type { CorpusDocument, CorpusHeader, CorpusMathObject } from './types.js';

export interface CorpusProjectionOptions {
  roles?: string[];
}

interface LineRange {
  startLine: number;
  endLine: number;
}

/**
 * Evaluates whether an access classification is visible to the provided audience roles.
 * Defaults to public-only (`['anonymous']`), failing closed for any non-public access level.
 */
export function isAccessAllowedForRoles(accessLevel: unknown, roles: string[] = ['anonymous']): boolean {
  const normalizedLevel =
    typeof accessLevel === 'string' && accessLevel.trim().length > 0 ? accessLevel.trim().toLowerCase() : 'public';

  if (normalizedLevel === 'public') {
    return true;
  }

  const roleSet = new Set(roles.map((r) => String(r).trim().toLowerCase()).filter(Boolean));
  if (
    roleSet.has('admin') ||
    roleSet.has('security_officer') ||
    roleSet.has('confidential') ||
    roleSet.has('docs.read.confidential')
  ) {
    return true;
  }

  if (
    normalizedLevel === 'internal' &&
    (roleSet.has('internal') || roleSet.has('member') || roleSet.has('staff') || roleSet.has('docs.read.internal'))
  ) {
    return true;
  }

  return false;
}

/**
 * Determines whether a document is permitted in the projected corpus.
 * Rejects non-public documents and redacted `title === 'Restricted'` placeholders.
 */
export function isDocumentAllowed(doc: CorpusDocument, roles: string[] = ['anonymous']): boolean {
  const rawRecord = doc as unknown as Record<string, unknown>;
  const docAccess = doc.frontmatter?.['access'] ?? doc.ast?.frontmatter?.['access'] ?? rawRecord['access'] ?? 'public';

  if (!isAccessAllowedForRoles(docAccess, roles)) {
    return false;
  }

  const effectiveTitle =
    doc.title || (typeof doc.ast?.frontmatter?.title === 'string' ? doc.ast.frontmatter.title : '');
  if (effectiveTitle === 'Restricted' && typeof docAccess === 'string' && docAccess.trim().toLowerCase() !== 'public') {
    return false;
  }

  return true;
}

function extractDirectiveAccessAttribute(attrBlock: string): string | undefined {
  if (!attrBlock || !attrBlock.includes('access')) {
    return undefined;
  }
  const match = /(?:^|[\s,{])access\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s,}]+))/.exec(attrBlock);
  if (!match) {
    return undefined;
  }
  return match[1] ?? match[2] ?? match[3];
}

function findRestrictedDirectiveLineRanges(rawContent: string | undefined, roles: string[]): LineRange[] {
  if (!rawContent || typeof rawContent !== 'string' || !rawContent.includes('access')) {
    return [];
  }

  const lines = rawContent.split('\n');
  const ranges: LineRange[] = [];
  const stack: Array<{ colons: number; restricted: boolean; startLine: number }> = [];
  let inCodeFence = false;

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNo = idx + 1;
    const line = lines[idx] ?? '';

    if (/^\s*(?:```|~~~)/.test(line)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) {
      continue;
    }

    const openMatch = /^\s*(:{3,})\s*([a-zA-Z0-9_-]+)(\{[^\n]*\})?/.exec(line);
    if (openMatch) {
      const colons = (openMatch[1] ?? ':::').length;
      const attrBlock = openMatch[3] ?? '';
      const attrAccess = extractDirectiveAccessAttribute(attrBlock);
      const restricted = attrAccess !== undefined ? !isAccessAllowedForRoles(attrAccess, roles) : false;
      stack.push({ colons, restricted, startLine: lineNo });
      continue;
    }

    const closeMatch = /^\s*(:{3,})\s*$/.exec(line);
    if (closeMatch && stack.length > 0) {
      const popped = stack.pop();
      if (popped?.restricted) {
        ranges.push({ startLine: popped.startLine, endLine: lineNo });
      }
    }
  }

  while (stack.length > 0) {
    const unclosed = stack.pop();
    if (unclosed?.restricted) {
      ranges.push({ startLine: unclosed.startLine, endLine: lines.length });
    }
  }

  return ranges;
}

function getExplicitNodeAccess(node: LumenNode): unknown {
  const explicit =
    node['access'] ??
    node.attributes?.['access'] ??
    node.props?.['access'] ??
    node.data?.['access'] ??
    node.attributes?.['data-access'] ??
    node.props?.['data-access'];

  if (explicit !== undefined) {
    return explicit;
  }

  if (node.type === 'rawHtmlPlaceholder' && typeof node.raw === 'string' && node.raw.includes('data-access')) {
    const match = /\bdata-access\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(node.raw);
    if (match) {
      return match[1] ?? match[2];
    }
  }

  return undefined;
}

function collectDescendantStartLines(node: LumenNode, out: number[]): void {
  const line = node.position?.start?.line;
  if (typeof line === 'number') {
    out.push(line);
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      collectDescendantStartLines(child, out);
    }
  }
}

function isLineWithinRanges(line: number, ranges: LineRange[]): boolean {
  return ranges.some((r) => line >= r.startLine && line <= r.endLine);
}

function isNodeRestrictedByRange(node: LumenNode, ranges: LineRange[]): boolean {
  if (ranges.length === 0) {
    return false;
  }

  const directLine = node.position?.start?.line;
  if (typeof directLine === 'number') {
    return isLineWithinRanges(directLine, ranges);
  }

  if (Array.isArray(node.children) && node.children.length > 0) {
    const childLines: number[] = [];
    for (const child of node.children) {
      collectDescendantStartLines(child, childLines);
    }
    if (childLines.length > 0 && childLines.every((l) => isLineWithinRanges(l, ranges))) {
      return true;
    }
  }

  return false;
}

export function extractNodePlainText(node: LumenNode): string {
  if (node.type === 'rawHtmlPlaceholder') {
    return '';
  }
  if (typeof node.value === 'string') {
    return node.value;
  }
  if (typeof node.tex === 'string') {
    return node.tex;
  }
  if (!Array.isArray(node.children)) {
    return '';
  }
  return node.children.map(extractNodePlainText).join(' ');
}

export function extractAstPlainText(nodes?: LumenNode[]): string {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return '';
  }
  return nodes
    .map(extractNodePlainText)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractFirstParagraphSummary(nodes?: LumenNode[]): string | undefined {
  if (!Array.isArray(nodes)) {
    return undefined;
  }
  for (const node of nodes) {
    if (node.type === 'paragraph') {
      const text = extractNodePlainText(node).replace(/\s+/g, ' ').trim();
      if (text) {
        return text;
      }
    }
    if (Array.isArray(node.children) && node.type !== 'heading') {
      const nested = extractFirstParagraphSummary(node.children);
      if (nested) {
        return nested;
      }
    }
  }
  return undefined;
}

function buildTocFromProjectedNodes(nodes: LumenNode[]): LumenTocItem[] {
  const toc: LumenTocItem[] = [];

  const visit = (list: LumenNode[]) => {
    for (const node of list) {
      if (node.type === 'heading') {
        const id = typeof node.id === 'string' ? node.id : '';
        const title = extractNodePlainText(node).replace(/\s+/g, ' ').trim();
        const level = Number(node.depth ?? 1);
        if (id || title) {
          toc.push({ id, title, level });
        }
      } else if (Array.isArray(node.children) && node.children.length > 0) {
        visit(node.children);
      }
    }
  };

  visit(nodes);
  return toc;
}

/**
 * Projects a `LumenDocumentAst` for the target audience roles:
 * - Strips any intra-document nodes with disallowed `access` attributes/directives.
 * - Recomputes `toc` strictly from remaining projected `children`.
 * - Clears `rawContent` so downstream serializers never leak unprojected raw markdown.
 */
export function projectDocumentAst(
  ast: LumenDocumentAst,
  roles: string[] = ['anonymous']
): { ast: LumenDocumentAst; strippedAny: boolean } {
  const restrictedRanges = findRestrictedDirectiveLineRanges(ast.rawContent, roles);
  let strippedAny = false;

  const filterNodes = (nodes: LumenNode[]): LumenNode[] => {
    const out: LumenNode[] = [];
    for (const node of nodes) {
      const explicitAccess = getExplicitNodeAccess(node);
      if (explicitAccess !== undefined && !isAccessAllowedForRoles(explicitAccess, roles)) {
        strippedAny = true;
        continue;
      }

      if (isNodeRestrictedByRange(node, restrictedRanges)) {
        strippedAny = true;
        continue;
      }

      if (Array.isArray(node.children)) {
        const filteredChildren = filterNodes(node.children);
        out.push({
          ...node,
          children: filteredChildren,
        });
      } else {
        out.push(node);
      }
    }
    return out;
  };

  const projectedChildren = filterNodes(ast.children ?? []);
  const projectedToc = strippedAny ? buildTocFromProjectedNodes(projectedChildren) : (ast.toc ?? []);

  return {
    ast: {
      ...ast,
      children: projectedChildren,
      toc: projectedToc,
      rawContent: undefined,
    },
    strippedAny,
  };
}

function collectAllowedAstIds(nodes: LumenNode[]): {
  headingIds: Set<string>;
  mathIds: Set<string>;
} {
  const headingIds = new Set<string>();
  const mathIds = new Set<string>();

  const walk = (list: LumenNode[]) => {
    for (const node of list) {
      if (node.type === 'heading' && typeof node.id === 'string' && node.id) {
        headingIds.add(node.id);
      } else if (node.type === 'mathEnvironment' && typeof node.id === 'string' && node.id) {
        mathIds.add(node.id);
      }
      if (Array.isArray(node.children) && node.children.length > 0) {
        walk(node.children);
      }
    }
  };

  walk(nodes);
  return { headingIds, mathIds };
}

/**
 * Projects a single `CorpusDocument` for the target audience roles, returning `null`
 * if the document itself is restricted.
 */
export function projectCorpusDocument(doc: CorpusDocument, options?: CorpusProjectionOptions): CorpusDocument | null {
  const roles = options?.roles ?? ['anonymous'];
  if (!isDocumentAllowed(doc, roles)) {
    return null;
  }

  if (!doc.ast) {
    return doc;
  }

  const { ast: projectedAst, strippedAny } = projectDocumentAst(doc.ast, roles);
  if (!strippedAny) {
    return {
      ...doc,
      ast: projectedAst,
    };
  }

  const { headingIds, mathIds } = collectAllowedAstIds(projectedAst.children);
  const allowedAnchors = new Set<string>([...headingIds, ...mathIds]);

  const filteredAnchors = (doc.anchors ?? []).filter((a) => allowedAnchors.has(a));
  const filteredHeaders: CorpusHeader[] | undefined = doc.headers
    ? doc.headers.filter((h) => !h.id || headingIds.has(h.id))
    : undefined;
  const filteredMath: CorpusMathObject[] = (doc.mathObjects ?? []).filter((m) => mathIds.has(m.id));

  return {
    ...doc,
    anchors: filteredAnchors,
    ...(filteredHeaders ? { headers: filteredHeaders } : {}),
    mathObjects: filteredMath,
    ast: projectedAst,
  };
}

/**
 * Projects an entire `CorpusGraph` into a filtered `CorpusGraph` containing only
 * audience-visible documents and projected AST nodes.
 */
export function projectCorpus(corpus: CorpusGraph, options?: CorpusProjectionOptions): CorpusGraph {
  const projectedGraph = new CorpusGraph();
  const roles = options?.roles ?? ['anonymous'];

  for (const doc of corpus.getAllDocuments()) {
    const projectedDoc = projectCorpusDocument(doc, { roles });
    if (projectedDoc) {
      projectedGraph.addDocument(projectedDoc);
    }
  }

  return projectedGraph;
}
