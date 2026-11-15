/**
 * Core Parser: prism-doc/2 to LumenDocumentAst Compiler
 */

import { normalizeLumenHtml } from './html.js';
import { directiveFromMarkdown } from 'mdast-util-directive';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { mathFromMarkdown } from 'mdast-util-math';
import { directive } from 'micromark-extension-directive';
import { gfm } from 'micromark-extension-gfm';
import { math } from './math-syntax.js';

import type { LumenDiagnostic } from '../ast/diagnostics.js';
import { createDiagnostic } from '../ast/diagnostics.js';
import { parseSafeFrontmatter } from '../ast/frontmatter.js';
import type {
  LumenCodeBlockNode,
  LumenDiagramNode,
  LumenDocumentAst,
  LumenHeadingNode,
  LumenInlineCodeNode,
  LumenMathBlockNode,
  LumenMathInlineNode,
  LumenNode,
  LumenParagraphNode,
  LumenRootNode,
} from '../ast/types.js';
import { generateMathAnchor } from '../math/anchors.js';
import type { MathEnvType } from '../math/environments.js';
import { isFormalMathEnv } from '../math/environments.js';
import { MathNumberingEngine } from '../math/numbering.js';
import {
  createAdmonitionNode,
  createMathEnvironmentNode,
  createTabItemNode,
  createTabsNode,
  isAdmonitionKind,
  preProcessDirectives,
  resolveDirectiveAttributes,
} from './directives.js';
import {
  computeTocFromNodes,
  extractHeadingMetadata,
  serializeHeadingInlineText,
  stripTrailingHeadingAttrFromChildren,
} from './headings.js';
import { maskPascalJsxElements, parseJsxTag, registerJsxFragmentParser } from './jsx-parser.js';
import { SMART_REF_PATTERN, parseSmartRef } from './smart-refs.js';
import { smartReferenceSyntax, smartReferenceFromMarkdown } from './smart-ref-syntax.js';
import { SourceText } from './source-text.js';

interface ParseContext {
  filePath?: string;
  attrMap: Map<string, Record<string, unknown>>;
  jsxMap: Map<string, SourceText>;
  source: SourceText;
  diagnostics: LumenDiagnostic[];
  numberingEngine: MathNumberingEngine;
  existingAnchors: Set<string>;
  mathIndexRef: { value: number };
  headingIndexRef: { value: number };
}

function parseMarkdownFragmentSync(
  fragmentContent: string,
  shared: {
    filePath?: string;
    diagnostics: LumenDiagnostic[];
    numberingEngine: MathNumberingEngine;
    existingAnchors: Set<string>;
    mathIndexRef: { value: number };
    headingIndexRef: { value: number };
  },
  source: SourceText = SourceText.original(fragmentContent)
): LumenNode[] {
  if (!fragmentContent || !fragmentContent.trim()) {
    return [];
  }

  // 1. Pre-process directives (masking attributes with unquoted arrays)
  const { attrMap, source: directivesSource } = preProcessDirectives(source);

  // 2. Pre-process PascalCase JSX tags (preserving multi-line tags & `{...}` props)
  const { source: parsedSource, ranges } = maskPascalJsxElements(directivesSource);
  const jsxMap = new Map([...ranges].map(([token, range]) => [token, directivesSource.slice(range.start, range.end)]));

  // 3. Parse Markdown with micromark & mdast extensions
  let mdastTree: { type: string; children?: unknown[] };
  try {
    mdastTree = fromMarkdown(parsedSource.value, {
      extensions: [gfm(), directive(), math(), smartReferenceSyntax()],
      mdastExtensions: [gfmFromMarkdown(), directiveFromMarkdown(), mathFromMarkdown(), smartReferenceFromMarkdown()],
    }) as { type: string; children?: unknown[] };
  } catch (err) {
    shared.diagnostics.push(
      createDiagnostic('MARKDOWN_PARSE_ERROR', err instanceof Error ? err.message : String(err), 'error', {
        file: shared.filePath,
      })
    );
    mdastTree = { type: 'root', children: [] };
  }

  const context: ParseContext = {
    filePath: shared.filePath,
    attrMap,
    jsxMap,
    source: parsedSource,
    diagnostics: shared.diagnostics,
    numberingEngine: shared.numberingEngine,
    existingAnchors: shared.existingAnchors,
    mathIndexRef: shared.mathIndexRef,
    headingIndexRef: shared.headingIndexRef,
  };

  const mdastChildren = ((mdastTree as Record<string, unknown>)['children'] ?? []) as Record<string, unknown>[];
  const transformedChildren: LumenNode[] = [];

  for (const child of mdastChildren) {
    const nodes = transformNode(child, context);
    if (Array.isArray(nodes)) {
      transformedChildren.push(...nodes);
    } else if (nodes) {
      transformedChildren.push(nodes);
    }
  }

  return normalizeLumenHtml(transformedChildren);
}

// Register default synchronous Markdown+JSX fragment parser for standalone parseJsxTag() calls
registerJsxFragmentParser((markdown, filePath, source) => {
  const localDiagnostics: LumenDiagnostic[] = [];
  const children = parseMarkdownFragmentSync(
    markdown,
    {
      filePath,
      diagnostics: localDiagnostics,
      numberingEngine: new MathNumberingEngine(),
      existingAnchors: new Set<string>(),
      mathIndexRef: { value: 0 },
      headingIndexRef: { value: 0 },
    },
    source
  );
  return { children, diagnostics: localDiagnostics };
});

export async function parseDocument(content: string, filePath?: string): Promise<LumenDocumentAst> {
  return parseDocumentSync(content, filePath);
}

/** The same compiler for synchronous adapters; no second Markdown parser. */
export function parseDocumentSync(content: string, filePath?: string): LumenDocumentAst {
  // Handle empty or whitespace-only documents
  if (!content || !content.trim()) {
    return {
      frontmatter: {},
      children: [],
      toc: [],
      diagnostics: [],
      rawContent: content,
    };
  }

  // 1. Safely split and validate frontmatter (rejects executable engines & oversized inputs)
  const fmResult = parseSafeFrontmatter(content, filePath);
  const diagnostics: LumenDiagnostic[] = [...fmResult.diagnostics];
  const parsedFrontmatter = fmResult.frontmatter;
  const bodyContent = fmResult.content;

  // 2. Parse document body recursively with shared numbering & diagnostics state
  const transformedChildren = parseMarkdownFragmentSync(
    bodyContent,
    {
      filePath,
      diagnostics,
      numberingEngine: new MathNumberingEngine(),
      existingAnchors: new Set<string>(),
      mathIndexRef: { value: 0 },
      headingIndexRef: { value: 0 },
    },
    SourceText.original(content).slice(content.length - bodyContent.length)
  );

  // 3. Derive Table of Contents strictly from parsed AST children (propagating ancestor access)
  const toc = computeTocFromNodes(transformedChildren);

  return {
    frontmatter: parsedFrontmatter,
    children: transformedChildren,
    toc,
    diagnostics,
    rawContent: bodyContent,
  };
}

function transformNode(rawNode: Record<string, unknown>, context: ParseContext): LumenNode | LumenNode[] {
  const node = { ...rawNode } as Record<string, any>;
  const start = node['position']?.start?.offset as number | undefined;
  const end = node['position']?.end?.offset as number | undefined;
  if (start !== undefined && end !== undefined) node['position'] = context.source.position(start, end);
  const type = String(node['type'] ?? '');

  switch (type) {
    case 'root': {
      const rawChildren = (node['children'] ?? []) as Record<string, unknown>[];
      const children = rawChildren.flatMap((c) => {
        const res = transformNode(c, context);
        return Array.isArray(res) ? res : [res];
      });
      return {
        type: 'root',
        children,
        position: node['position'],
      } as LumenRootNode;
    }

    case 'paragraph': {
      const rawChildren = (node['children'] ?? []) as Record<string, unknown>[];
      const children = rawChildren.flatMap((c) => {
        const res = transformNode(c, context);
        return Array.isArray(res) ? res : [res];
      });
      return {
        type: 'paragraph',
        children,
        position: node['position'],
      } as LumenParagraphNode;
    }

    case 'heading': {
      context.headingIndexRef.value += 1;
      const depth = Number(node['depth'] ?? 1) as 1 | 2 | 3 | 4 | 5 | 6;
      const rawChildren = (node['children'] ?? []) as Record<string, unknown>[];
      const children = rawChildren.flatMap((c) => {
        const res = transformNode(c, context);
        return Array.isArray(res) ? res : [res];
      });

      const fullText = serializeHeadingInlineText(children);
      const meta = extractHeadingMetadata(fullText, context.headingIndexRef.value);
      const cleanedChildren = meta.hasTrailingAttrBlock ? stripTrailingHeadingAttrFromChildren(children) : children;
      let headingId = meta.id;
      if (meta.hasTrailingAttrBlock && context.existingAnchors.has(headingId)) {
        context.diagnostics.push({
          code: 'LUMEN_DUPLICATE_ANCHOR',
          message: `Duplicate heading anchor: ${headingId}`,
          severity: 'error',
        });
      } else {
        let suffix = 1;
        while (context.existingAnchors.has(headingId)) headingId = `${meta.id}-${suffix++}`;
      }
      context.existingAnchors.add(headingId);

      return {
        type: 'heading',
        depth,
        id: headingId,
        ...(meta.access !== undefined ? { access: meta.access } : {}),
        ...(meta.attributes !== undefined ? { attributes: meta.attributes } : {}),
        children: cleanedChildren,
        position: node['position'],
      } as LumenHeadingNode;
    }

    case 'text': {
      return { type: 'text', value: String(node['value'] ?? ''), position: node['position'] };
    }

    case 'lumenSmartReference': {
      const value = String(node['value'] ?? ''),
        match = SMART_REF_PATTERN.exec(value);
      if (!match) throw new Error('Smart reference token does not match its syntax');
      return { ...parseSmartRef(value, match[1]!, match[2]!), position: node['position'] };
    }

    case 'inlineCode': {
      return {
        type: 'inlineCode',
        value: String(node['value'] ?? ''),
        position: node['position'],
      } as LumenInlineCodeNode;
    }

    case 'code': {
      const rawLang = node['lang'];
      const rawMeta = node['meta'];
      const lang = typeof rawLang === 'string' ? rawLang.trim() : undefined;
      const meta = typeof rawMeta === 'string' ? rawMeta.trim() : undefined;
      const value = String(node['value'] ?? '');

      if (lang === 'mermaid') {
        const hasElk = value.includes('"defaultRenderer": "elk"') || value.includes("'defaultRenderer': 'elk'");
        return {
          type: 'diagram',
          engine: 'mermaid',
          code: value,
          elk: hasElk,
          position: node['position'],
        } as LumenDiagramNode;
      }

      return {
        type: 'codeBlock',
        lang,
        meta,
        value,
        position: node['position'],
      } as LumenCodeBlockNode;
    }

    case 'inlineMath': {
      return {
        type: 'mathInline',
        tex: String(node['value'] ?? ''),
        position: node['position'],
      } as LumenMathInlineNode;
    }

    case 'math': {
      return {
        type: 'mathBlock',
        tex: String(node['value'] ?? ''),
        position: node['position'],
      } as LumenMathBlockNode;
    }

    case 'containerDirective':
    case 'leafDirective': {
      const name = String(node['name'] ?? '').toLowerCase();
      const rawAttrs = node['attributes'] as Record<string, unknown> | undefined;
      const resolvedAttrs = resolveDirectiveAttributes(rawAttrs, context.attrMap);

      const rawChildren = (node['children'] ?? []) as Record<string, unknown>[];
      const children = rawChildren.flatMap((c) => {
        const res = transformNode(c, context);
        return Array.isArray(res) ? res : [res];
      });

      // 1. Formal Math Environments (and custom environments like conjecture, postulate)
      if (
        isFormalMathEnv(name) ||
        name === 'conjecture' ||
        name === 'postulate' ||
        name === 'definition' ||
        name === 'theorem'
      ) {
        context.mathIndexRef.value += 1;
        const mathEnvKind = (isFormalMathEnv(name) ? name : 'theorem') as MathEnvType;

        // Auto assign number if not explicit
        if (!resolvedAttrs['number'] && !resolvedAttrs['unnumbered'] && name !== 'proof' && name !== 'remark') {
          const assigned = context.numberingEngine.assignNumber(mathEnvKind, resolvedAttrs);
          if (assigned) resolvedAttrs['number'] = assigned;
        }

        // Auto assign anchor if not explicit
        if (!resolvedAttrs['id']) {
          resolvedAttrs['id'] = generateMathAnchor(
            mathEnvKind,
            resolvedAttrs,
            context.mathIndexRef.value,
            context.existingAnchors
          );
        }

        return { ...createMathEnvironmentNode(mathEnvKind, resolvedAttrs, children), position: node['position'] };
      }

      // 2. Admonitions
      if (isAdmonitionKind(name)) {
        return { ...createAdmonitionNode(name, resolvedAttrs, children), position: node['position'] };
      }

      // 3. Tabs & Tab Items
      if (name === 'tabs') {
        return { ...createTabsNode(resolvedAttrs, children), position: node['position'] };
      }
      if (name === 'tab') {
        return { ...createTabItemNode(resolvedAttrs, children), position: node['position'] };
      }

      // 4. Fallback Container
      return {
        type: 'containerDirective',
        name,
        access: typeof resolvedAttrs['access'] === 'string' ? resolvedAttrs['access'] : undefined,
        attributes: resolvedAttrs,
        children,
        position: node['position'],
      };
    }

    case 'html': {
      const rawHtml = String(node['value'] ?? '');
      const tokenMatch = rawHtml.trim().match(/^<!--(__LUMEN_JSX_TOKEN_\d+__)-->$/);
      const candidate = tokenMatch?.[1] ? context.jsxMap.get(tokenMatch[1]) : undefined;
      const candidatePosition = candidate?.position(0, candidate.value.length);
      // The token's registered source range is authority; literal user comments
      // cannot impersonate a generated placeholder at a different location.
      const jsxSource =
        candidatePosition?.start.offset === node['position']?.start.offset &&
        candidatePosition?.end.offset === node['position']?.end.offset
          ? candidate
          : undefined;
      const effectiveHtml = jsxSource?.value ?? rawHtml;

      const { node: jsxNode, diagnostics: jsxDiagnostics } = parseJsxTag(
        effectiveHtml,
        context.filePath,
        (innerMd, fp, innerSource) => {
          const innerDiag: LumenDiagnostic[] = [];
          const innerChildren = parseMarkdownFragmentSync(
            innerMd,
            {
              filePath: fp ?? context.filePath,
              diagnostics: innerDiag,
              numberingEngine: context.numberingEngine,
              existingAnchors: context.existingAnchors,
              mathIndexRef: context.mathIndexRef,
              headingIndexRef: context.headingIndexRef,
            },
            innerSource
          );
          return { children: innerChildren, diagnostics: innerDiag };
        },
        jsxSource
      );
      context.diagnostics.push(...jsxDiagnostics);
      return jsxSource ? jsxNode : { ...jsxNode, position: node['position'] };
    }

    default: {
      // Pass-through standard mdast nodes (list, listItem, blockquote, table, etc.)
      const rawChildren = (node['children'] ?? []) as Record<string, unknown>[];
      if (rawChildren.length > 0) {
        const children = rawChildren.flatMap((c) => {
          const res = transformNode(c, context);
          return Array.isArray(res) ? res : [res];
        });
        return {
          ...node,
          children,
        } as LumenNode;
      }
      return node as LumenNode;
    }
  }
}
