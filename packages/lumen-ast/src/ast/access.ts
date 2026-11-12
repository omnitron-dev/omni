import { createRoleHierarchy, createPermissionChecker, type RoleHierarchy } from '@omnitron-dev/access';
import { normalizeLumenHtml } from '../compiler/html.js';
import { computeTocFromNodes } from '../compiler/headings.js';
import type { LumenDocumentAst, LumenNode } from './types.js';

export const defaultDocRoleHierarchy: RoleHierarchy = createRoleHierarchy({
  anonymous: { level: 0 },
  staff: { level: 10, inherits: ['anonymous'] },
  security_officer: { level: 20, inherits: ['staff'] },
  admin: { level: 30, inherits: ['security_officer'] },
});
export const defaultRoleGrants: Record<string, string[]> = {
  anonymous: ['docs.read.public'],
  staff: ['docs.read.public', 'docs.read.internal'],
  security_officer: ['docs.read.*'],
  admin: ['*'],
};

export interface DocumentAccessOptions {
  hierarchy?: RoleHierarchy;
  grants?: Record<string, string[]>;
}
export type DocumentAccessPredicate = (level: unknown) => boolean;

/** Compile grants once per projection; malformed and unknown classifications deny. */
export function createDocumentAccessPredicate(
  roles: readonly string[] = ['anonymous'],
  options: DocumentAccessOptions = {},
  permissions: readonly string[] = []
): DocumentAccessPredicate {
  const hierarchy = options.hierarchy ?? defaultDocRoleHierarchy;
  const grants = options.grants ?? defaultRoleGrants;
  const expanded = hierarchy.expandRoleSet([...roles]);
  const allows = createPermissionChecker([...permissions, ...expanded.flatMap((role) => grants[role] ?? [])]);
  return (level) => {
    if (level === undefined) return true;
    if (typeof level !== 'string') return false;
    const classification = level.trim().toLowerCase();
    if (classification === 'public') return true;
    return (
      (classification === 'internal' || classification === 'confidential') && allows(`docs.read.${classification}`)
    );
  };
}

/** Every declaration restricts access; one public attribute cannot override another. */
function permitsNode(node: LumenNode, allows: DocumentAccessPredicate): boolean {
  return [node, node.attributes, node.props, node.data].every(
    (record) =>
      !record ||
      ['access', 'data-access', 'dataAccess'].every((key) => !Object.hasOwn(record, key) || allows(record[key]))
  );
}

interface HeadingScope {
  depth: number;
  allowed: boolean;
}
function sectionAllowed(scopes: HeadingScope[], depth: number | undefined, explicit: boolean): boolean {
  if (depth !== undefined) {
    while (scopes.length && scopes[scopes.length - 1]!.depth >= depth) scopes.pop();
    scopes.push({ depth, allowed: explicit });
  }
  return explicit && scopes.every((scope) => scope.allowed);
}

export interface DocumentProjection {
  allowed: boolean;
  ast: LumenDocumentAst;
  strippedAny: boolean;
}

/**
 * Canonical projection for SSG, RPC, search, MCP and exports. It consumes parsed
 * nodes, never reparses Markdown with a second line-range/regular-expression policy.
 * A restricted heading governs its whole section, including nested subsections.
 */
export function projectDocumentAccess(ast: LumenDocumentAst, allows: DocumentAccessPredicate): DocumentProjection {
  if (!Array.isArray(ast.children)) throw new TypeError('Document projection requires parsed children');
  if (ast.diagnostics?.some((diagnostic) => diagnostic.severity === 'error') || !allows(ast.frontmatter?.access))
    return {
      allowed: false,
      strippedAny: true,
      ast: { frontmatter: { title: 'Restricted', access: 'restricted' }, children: [], toc: [], diagnostics: [] },
    };
  let strippedNodes = 0;
  let remaining = 100_000;
  const project = (nodes: LumenNode[], depth: number): LumenNode[] => {
    if (depth > 128) throw new Error('Document projection nesting limit exceeded');
    const sections: HeadingScope[] = [];
    const result: LumenNode[] = [];
    for (const node of nodes) {
      if (--remaining < 0) throw new Error('Document projection node limit exceeded');
      const level =
        node.type === 'heading'
          ? Number(node.depth ?? 1)
          : node.type === 'htmlElement' && /^h[1-6]$/.test(String(node.tagName))
            ? Number(String(node.tagName)[1])
            : undefined;
      if (!sectionAllowed(sections, level, permitsNode(node, allows))) {
        strippedNodes++;
        continue;
      }
      const projected = { ...node };
      if (node.children) {
        const before = strippedNodes;
        projected.children = project(node.children, depth + 1);
        // Raw JSX/source caches must not preserve removed descendants.
        delete projected.raw;
        // A generic container's alternate text must not restore redacted children.
        // tabItem.value is a declared control identifier, not a body-text cache.
        if (strippedNodes !== before && node.type !== 'tabItem') delete projected.value;
      }
      result.push(projected);
    }
    return result;
  };
  const children = project(normalizeLumenHtml(ast.children), 0);
  return {
    allowed: true,
    strippedAny: strippedNodes > 0,
    ast: {
      frontmatter: { ...ast.frontmatter },
      children,
      toc: computeTocFromNodes(children),
      diagnostics: [],
    },
  };
}
