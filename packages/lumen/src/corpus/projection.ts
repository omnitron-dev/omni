import {
  createDocumentAccessPredicate,
  projectDocumentAccess,
  type DocumentAccessOptions,
  type DocumentProjection,
  type LumenDocumentAst,
  type LumenNode,
} from '@omnitron-dev/lumen-ast';
import { CorpusGraph } from './graph.js';
import type { CorpusDocument, CorpusHeader, CorpusMathObject } from './types.js';

export interface CorpusProjectionOptions {
  roles?: string[];
  accessFilter?: DocumentAccessOptions;
}

export function isAccessAllowedForRoles(
  accessLevel: unknown,
  roles: string[] = ['anonymous'],
  options?: DocumentAccessOptions
): boolean {
  return createDocumentAccessPredicate(roles, options)(accessLevel);
}

export function isDocumentAllowed(
  doc: CorpusDocument,
  roles: string[] = ['anonymous'],
  options?: DocumentAccessOptions
): boolean {
  const allows = createDocumentAccessPredicate(roles, options);
  return [
    doc.frontmatter?.['access'],
    doc.ast?.frontmatter?.access,
    (doc as unknown as Record<string, unknown>)['access'],
  ].every(allows);
}

export function projectDocumentAst(
  ast: LumenDocumentAst,
  roles: string[] = ['anonymous'],
  options?: DocumentAccessOptions
): DocumentProjection {
  return projectDocumentAccess(ast, createDocumentAccessPredicate(roles, options));
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
  if (!isDocumentAllowed(doc, roles, options?.accessFilter)) {
    return null;
  }

  if (!doc.ast) {
    return doc;
  }

  const { ast: projectedAst, strippedAny, allowed } = projectDocumentAst(doc.ast, roles, options?.accessFilter);
  if (!allowed) return null;
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
    const projectedDoc = projectCorpusDocument(doc, { ...options, roles });
    if (projectedDoc) {
      projectedGraph.addDocument(projectedDoc);
    }
  }

  return projectedGraph;
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
