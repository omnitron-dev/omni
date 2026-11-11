import { Injectable } from '@omnitron-dev/titan';
import { createRoleHierarchy, createPermissionChecker, type RoleHierarchy } from '@omnitron-dev/access';
import {
  parseSafeFrontmatter,
  toCleanMarkdown,
  type LumenDiagnostic,
  type LumenDocumentAst,
  type LumenNode,
  type LumenTocItem,
} from '@omnitron-dev/lumen-ast';
import type { AccessFilterOptions, LumenSessionContext } from '../interfaces.js';

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

const INLINE_ATTR_ACCESS_RE = /\baccess\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s}"']+))/;

interface LineRange {
  startLine: number;
  endLine: number;
}

interface ParsedDirectiveFence {
  dirName: string;
  startLine: number;
  endLine: number;
  access?: string;
  id?: string;
  title?: string;
  label?: string;
  syncKey?: string;
  matched?: boolean;
}

function extractInlineAttr(attrBlock: string, attrName: string): string | undefined {
  const re = new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s}"']+))`);
  const match = attrBlock.match(re);
  if (!match) {
    return undefined;
  }
  const raw = match[1] ?? match[2] ?? match[3] ?? '';
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseRawDirectivesAndHeadings(rawContent: string): {
  directives: ParsedDirectiveFence[];
  headingLines: Array<{ line: number; access: string }>;
} {
  const directives: ParsedDirectiveFence[] = [];
  const headingLines: Array<{ line: number; access: string }> = [];
  const lines = rawContent.split(/\r?\n/);

  interface OpenFence {
    dirName: string;
    startLine: number;
    access?: string;
    id?: string;
    title?: string;
    label?: string;
    syncKey?: string;
  }

  const stack: OpenFence[] = [];
  let inCodeFence = false;
  let codeFenceMarker = '';

  for (let idx = 0; idx < lines.length; idx += 1) {
    const lineText = lines[idx] ?? '';
    const lineNum = idx + 1;

    const codeFenceMatch = lineText.match(/^\s*(`{3,}|~{3,})/);
    if (codeFenceMatch && codeFenceMatch[1]) {
      const markerChar = codeFenceMatch[1][0] ?? '`';
      if (!inCodeFence) {
        inCodeFence = true;
        codeFenceMarker = markerChar;
        continue;
      }
      if (markerChar === codeFenceMarker) {
        inCodeFence = false;
        codeFenceMarker = '';
        continue;
      }
    }

    if (inCodeFence) {
      continue;
    }

    const closeMatch = lineText.match(/^\s*(:{3,})\s*$/);
    if (closeMatch && stack.length > 0) {
      const popped = stack.pop();
      if (popped) {
        directives.push({
          ...popped,
          endLine: lineNum,
        });
      }
      continue;
    }

    const openContainerMatch = lineText.match(/^\s*(:{3,})\s*([a-zA-Z0-9_-]+)(.*)$/);
    if (openContainerMatch && openContainerMatch[2]) {
      const dirName = openContainerMatch[2].toLowerCase();
      const attrSuffix = openContainerMatch[3] ?? '';
      const braceStart = attrSuffix.indexOf('{');
      const braceEnd = attrSuffix.lastIndexOf('}');
      const attrBlock = braceStart !== -1 && braceEnd > braceStart ? attrSuffix.slice(braceStart + 1, braceEnd) : '';

      const accessMatch = attrBlock ? attrBlock.match(INLINE_ATTR_ACCESS_RE) : null;
      const access = accessMatch ? (accessMatch[1] ?? accessMatch[2] ?? accessMatch[3] ?? '').trim() : undefined;

      stack.push({
        dirName,
        startLine: lineNum,
        access: access && access.length > 0 ? access : undefined,
        id: attrBlock ? extractInlineAttr(attrBlock, 'id') : undefined,
        title: attrBlock ? extractInlineAttr(attrBlock, 'title') : undefined,
        label: attrBlock ? (extractInlineAttr(attrBlock, 'label') ?? extractInlineAttr(attrBlock, 'value')) : undefined,
        syncKey: attrBlock ? extractInlineAttr(attrBlock, 'syncKey') : undefined,
      });
      continue;
    }

    const leafDirectiveMatch = lineText.match(/^\s*::([a-zA-Z0-9_-]+)(.*)$/);
    if (leafDirectiveMatch && leafDirectiveMatch[1] && !lineText.trimStart().startsWith(':::')) {
      const dirName = leafDirectiveMatch[1].toLowerCase();
      const attrSuffix = leafDirectiveMatch[2] ?? '';
      const braceStart = attrSuffix.indexOf('{');
      const braceEnd = attrSuffix.lastIndexOf('}');
      const attrBlock = braceStart !== -1 && braceEnd > braceStart ? attrSuffix.slice(braceStart + 1, braceEnd) : '';
      const access = attrBlock ? extractInlineAttr(attrBlock, 'access') : undefined;
      if (access) {
        directives.push({
          dirName,
          startLine: lineNum,
          endLine: lineNum,
          access,
        });
      }
      continue;
    }

    const headingMatch = lineText.match(/^\s*#{1,6}\s+.*\{([^}]*)\}\s*$/);
    if (headingMatch && headingMatch[1]) {
      const headingAccess = extractInlineAttr(headingMatch[1], 'access');
      if (headingAccess) {
        headingLines.push({ line: lineNum, access: headingAccess });
      }
    }
  }

  while (stack.length > 0) {
    const unclosed = stack.pop();
    if (unclosed) {
      directives.push({
        ...unclosed,
        endLine: lines.length,
      });
    }
  }

  return { directives, headingLines };
}

function extractNodeDirectAccess(node: Record<string, any>): string | undefined {
  const attrs = node['attributes'] as Record<string, unknown> | undefined;
  const props = node['props'] as Record<string, unknown> | undefined;
  const data = node['data'] as Record<string, any> | undefined;
  const candidates: unknown[] = [
    node['access'],
    attrs?.['access'],
    props?.['access'],
    data?.['access'],
    data?.['hProperties']?.['access'],
  ];

  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null) {
      const str = String(candidate).trim();
      if (str.length > 0) {
        return str;
      }
    }
  }
  return undefined;
}

function computeNodeLineSpan(node: Record<string, any>): LineRange | null {
  const pos = node['position'] as { start?: { line?: number }; end?: { line?: number } } | undefined;
  let minLine = typeof pos?.start?.line === 'number' ? pos.start.line : Number.POSITIVE_INFINITY;
  let maxLine = typeof pos?.end?.line === 'number' ? pos.end.line : Number.NEGATIVE_INFINITY;

  if (Number.isFinite(minLine) && !Number.isFinite(maxLine)) {
    maxLine = minLine;
  }

  const children = node['children'];
  if (Array.isArray(children)) {
    for (const child of children) {
      if (child && typeof child === 'object') {
        const childSpan = computeNodeLineSpan(child as Record<string, any>);
        if (childSpan) {
          if (childSpan.startLine < minLine) minLine = childSpan.startLine;
          if (childSpan.endLine > maxLine) maxLine = childSpan.endLine;
        }
      }
    }
  }

  if (!Number.isFinite(minLine) || !Number.isFinite(maxLine)) {
    return null;
  }

  return { startLine: minLine, endLine: maxLine };
}

function matchesEmptyRestrictedDirective(
  node: Record<string, any>,
  restrictedDirectives: ParsedDirectiveFence[]
): ParsedDirectiveFence | undefined {
  const nodeType = String(node['type'] ?? '');
  for (const fence of restrictedDirectives) {
    if (fence.matched) {
      continue;
    }

    if (nodeType === 'admonition' && String(node['kind'] ?? '').toLowerCase() === fence.dirName) {
      if (!fence.title || String(node['title'] ?? '') === fence.title) {
        return fence;
      }
    }

    if (nodeType === 'mathEnvironment') {
      const envKind = String(node['envKind'] ?? '').toLowerCase();
      const isCompatibleEnv =
        envKind === fence.dirName ||
        (envKind === 'theorem' && (fence.dirName === 'conjecture' || fence.dirName === 'postulate'));
      if (isCompatibleEnv) {
        const idMatches = !fence.id || String(node['id'] ?? '') === fence.id;
        const titleMatches = !fence.title || String(node['title'] ?? '') === fence.title;
        if (idMatches && titleMatches) {
          return fence;
        }
      }
    }

    if (nodeType === 'tabItem' && fence.dirName === 'tab') {
      if (!fence.label || String(node['label'] ?? '') === fence.label) {
        return fence;
      }
    }

    if (nodeType === 'tabs' && fence.dirName === 'tabs') {
      if (!fence.syncKey || String(node['syncKey'] ?? '') === fence.syncKey) {
        return fence;
      }
    }

    if (nodeType === 'containerDirective' && String(node['name'] ?? '').toLowerCase() === fence.dirName) {
      return fence;
    }
  }
  return undefined;
}

function hasAnyHeadingInSubtree(nodes: LumenNode[]): boolean {
  for (const item of nodes) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    if (item.type === 'heading') {
      return true;
    }
    if (Array.isArray(item.children) && hasAnyHeadingInSubtree(item.children)) {
      return true;
    }
  }
  return false;
}

function plainTextOfNode(node: LumenNode): string {
  if (!node || typeof node !== 'object') {
    return '';
  }
  if (node.type === 'text' || node.type === 'inlineCode') {
    return String(node.value ?? '');
  }
  if (node.type === 'mathInline') {
    return `$${String(node.tex ?? node.value ?? '')}$`;
  }
  if (node.type === 'smartRef') {
    return String(node.raw ?? node.target ?? '');
  }
  if (Array.isArray(node.children)) {
    return node.children.map((child) => plainTextOfNode(child)).join('');
  }
  if (node.value !== undefined && node.value !== null) {
    return String(node.value);
  }
  return '';
}

function collectHeadingsToc(nodes: LumenNode[]): LumenTocItem[] {
  const toc: LumenTocItem[] = [];
  const walk = (items: LumenNode[]): void => {
    for (const item of items) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      if (item.type === 'heading') {
        const rawTitle = plainTextOfNode(item)
          .replace(/\s+\{#[^}]+\}\s*$/, '')
          .replace(/\s+\{[^}]*\baccess\s*=[^}]*\}\s*$/, '')
          .trim();
        toc.push({
          id: String(item.id ?? ''),
          title: rawTitle,
          level: Number(item.depth ?? 1),
        });
      }
      if (Array.isArray(item.children) && item.children.length > 0) {
        walk(item.children);
      }
    }
  };
  walk(nodes);
  return toc;
}

/**
 * Extracts validated frontmatter metadata (`id`, `title`, `access`) from raw markdown/PDX content
 * via the shared data-only `parseSafeFrontmatter` parser. Fails closed on executable or malformed frontmatter.
 */
export function extractDocumentMetadata(content: string): { id?: string; title?: string; access: string } {
  if (!content || typeof content !== 'string') {
    return { access: 'public' };
  }

  const withoutBom = content.startsWith('\uFEFF') ? content.slice(1) : content;
  if (!withoutBom.startsWith('---') && !withoutBom.startsWith('~~~')) {
    return { access: 'public' };
  }

  const parsed = parseSafeFrontmatter(content);
  const hasBlockingError = parsed.diagnostics.some(
    (d) =>
      d.code === 'EXECUTABLE_FRONTMATTER_FORBIDDEN' ||
      d.code === 'DOCUMENT_TOO_LARGE' ||
      d.code === 'FRONTMATTER_TOO_LARGE' ||
      d.code === 'FRONTMATTER_INVALID_ACCESS' ||
      d.code === 'FRONTMATTER_PARSE_ERROR'
  );

  const id =
    typeof parsed.frontmatter.id === 'string' && parsed.frontmatter.id.trim().length > 0
      ? parsed.frontmatter.id.trim()
      : undefined;
  const title =
    typeof parsed.frontmatter.title === 'string' && parsed.frontmatter.title.trim().length > 0
      ? parsed.frontmatter.title.trim()
      : undefined;
  const rawAccess =
    typeof parsed.frontmatter.access === 'string' && parsed.frontmatter.access.trim().length > 0
      ? parsed.frontmatter.access.trim()
      : undefined;

  if (hasBlockingError) {
    return {
      id,
      title,
      access: rawAccess && rawAccess.toLowerCase() !== 'public' ? rawAccess : 'restricted',
    };
  }

  return {
    id,
    title,
    access: rawAccess ?? 'public',
  };
}

export function extractDocumentAccess(content: string): string {
  return extractDocumentMetadata(content).access;
}

@Injectable()
export class AccessFilterService {
  private readonly hierarchy: RoleHierarchy;
  private readonly grants: Record<string, string[]>;

  constructor(options?: AccessFilterOptions) {
    this.hierarchy = options?.hierarchy ?? defaultDocRoleHierarchy;
    this.grants = options?.grants ?? defaultRoleGrants;
  }

  getEffectiveRoles(session?: LumenSessionContext | null): string[] {
    if (!session || session.valid !== true || !Array.isArray(session.roles) || session.roles.length === 0) {
      return ['anonymous'];
    }
    const validRoles = session.roles.filter((r): r is string => typeof r === 'string' && r.trim().length > 0);
    return validRoles.length > 0 ? validRoles : ['anonymous'];
  }

  isAllowed(userRoles: string[], accessLevel?: string): boolean {
    const level = (accessLevel ? String(accessLevel) : 'public').toLowerCase();

    // Standard public access is permitted to all
    if (level === 'public') {
      return true;
    }

    // Confidential and internal require valid non-empty roles
    if (!userRoles || !Array.isArray(userRoles) || userRoles.length === 0) {
      return false;
    }

    // Only known levels are permitted; non-standard clearances default to denied
    if (level !== 'internal' && level !== 'confidential') {
      return false;
    }

    const expanded = this.hierarchy.expandRoleSet(userRoles);
    const grantedKeys = expanded.flatMap((r) => this.grants[r] ?? []);
    const checker = createPermissionChecker(grantedKeys);

    if (level === 'internal') {
      return checker('docs.read.internal');
    }
    if (level === 'confidential') {
      return checker('docs.read.confidential');
    }

    return false;
  }

  filterSections<T extends { access?: string; level?: string }>(sections: T[], userRoles: string[]): T[] {
    return sections.filter((sec) => this.isAllowed(userRoles, sec.access ?? sec.level));
  }

  filterRawMarkdownContent(content: string, userRoles: string[], explicitAccess?: string): string | null {
    const docAccess = explicitAccess ?? extractDocumentAccess(content);
    if (!this.isAllowed(userRoles, docAccess)) {
      return null;
    }
    if (!/\baccess\s*=/.test(content)) {
      return content;
    }

    const { directives, headingLines } = parseRawDirectivesAndHeadings(content);
    const forbiddenRanges: LineRange[] = [];
    for (const fence of directives) {
      if (fence.access && !this.isAllowed(userRoles, fence.access)) {
        forbiddenRanges.push({ startLine: fence.startLine, endLine: fence.endLine });
      }
    }
    for (const hLine of headingLines) {
      if (!this.isAllowed(userRoles, hLine.access)) {
        forbiddenRanges.push({ startLine: hLine.line, endLine: hLine.line });
      }
    }
    if (forbiddenRanges.length === 0) {
      return content;
    }

    const lines = content.split(/\r?\n/);
    const keptLines = lines.filter((_, idx) => {
      const lineNum = idx + 1;
      return !forbiddenRanges.some((range) => range.startLine <= lineNum && lineNum <= range.endLine);
    });
    return keptLines.join('\n');
  }

  filterAst(ast: LumenDocumentAst, userRoles: string[]): LumenDocumentAst {
    const docAccess = ast.frontmatter?.access ?? 'public';
    if (!this.isAllowed(userRoles, String(docAccess))) {
      return {
        frontmatter: {
          title: 'Restricted',
          access: String(docAccess),
        },
        children: [],
        toc: [],
        diagnostics: [],
        rawContent: '',
      };
    }

    const restrictedRanges: LineRange[] = [];
    const restrictedEmptyDirectives: ParsedDirectiveFence[] = [];

    if (typeof ast.rawContent === 'string' && ast.rawContent.length > 0) {
      const { directives, headingLines } = parseRawDirectivesAndHeadings(ast.rawContent);
      for (const fence of directives) {
        if (fence.access && !this.isAllowed(userRoles, fence.access)) {
          restrictedRanges.push({ startLine: fence.startLine, endLine: fence.endLine });
          restrictedEmptyDirectives.push(fence);
        }
      }
      for (const hLine of headingLines) {
        if (!this.isAllowed(userRoles, hLine.access)) {
          restrictedRanges.push({ startLine: hLine.line, endLine: hLine.line });
        }
      }
    }

    const removedRanges: LineRange[] = [...restrictedRanges];
    let removedAnyNode = false;

    const filterNodes = (nodes: LumenNode[]): LumenNode[] => {
      const kept: LumenNode[] = [];

      for (const rawItem of nodes) {
        if (!rawItem || typeof rawItem !== 'object') {
          continue;
        }
        const recordNode = rawItem as Record<string, any>;
        const directAccess = extractNodeDirectAccess(recordNode);
        const nodeSpan = computeNodeLineSpan(recordNode);

        if (directAccess !== undefined && !this.isAllowed(userRoles, directAccess)) {
          removedAnyNode = true;
          if (nodeSpan) {
            removedRanges.push(nodeSpan);
          }
          continue;
        }

        if (
          nodeSpan &&
          restrictedRanges.some((range) => range.startLine <= nodeSpan.startLine && nodeSpan.endLine <= range.endLine)
        ) {
          removedAnyNode = true;
          continue;
        }

        if (!nodeSpan && restrictedEmptyDirectives.length > 0) {
          const matchedEmpty = matchesEmptyRestrictedDirective(recordNode, restrictedEmptyDirectives);
          if (matchedEmpty) {
            matchedEmpty.matched = true;
            removedAnyNode = true;
            continue;
          }
        }

        if (Array.isArray(rawItem.children)) {
          const hadOriginalChildren = rawItem.children.length > 0;
          const nextChildren = filterNodes(rawItem.children);
          const isContainerShell =
            rawItem.type === 'admonition' ||
            rawItem.type === 'mathEnvironment' ||
            rawItem.type === 'tabs' ||
            rawItem.type === 'tabItem' ||
            rawItem.type === 'containerDirective';

          if (isContainerShell && hadOriginalChildren && nextChildren.length === 0) {
            removedAnyNode = true;
            continue;
          }

          kept.push({
            ...rawItem,
            children: nextChildren,
          });
        } else {
          kept.push(rawItem);
        }
      }

      return kept;
    };

    const originalChildren = ast.children ?? [];
    const filteredChildren = filterNodes(originalChildren);

    const shouldRecomputeTocFromHeadings =
      hasAnyHeadingInSubtree(originalChildren) || typeof ast.rawContent === 'string';

    const filteredToc: LumenTocItem[] = shouldRecomputeTocFromHeadings
      ? collectHeadingsToc(filteredChildren)
      : (ast.toc ?? []).filter((tocEntry: any) => {
          const entryAccess = tocEntry?.access ?? tocEntry?.level_access;
          if (entryAccess !== undefined && entryAccess !== null && !this.isAllowed(userRoles, String(entryAccess))) {
            return false;
          }
          return true;
        });

    const sanitizedFrontmatter = ast.frontmatter ? { ...ast.frontmatter } : {};

    const filteredDiagnostics: LumenDiagnostic[] = (ast.diagnostics ?? []).filter((diag) => {
      if (removedRanges.length === 0 && !removedAnyNode) {
        return true;
      }
      if (typeof diag.line !== 'number') {
        return false;
      }
      return !removedRanges.some((range) => range.startLine <= diag.line! && diag.line! <= range.endLine);
    });

    const reconstructedRawContent =
      filteredChildren.length > 0
        ? toCleanMarkdown({
            frontmatter: sanitizedFrontmatter,
            children: filteredChildren,
            toc: filteredToc,
            diagnostics: [],
            rawContent: '',
          })
        : '';

    return {
      frontmatter: sanitizedFrontmatter,
      children: filteredChildren,
      toc: filteredToc,
      diagnostics: filteredDiagnostics,
      rawContent: reconstructedRawContent,
    };
  }
}
