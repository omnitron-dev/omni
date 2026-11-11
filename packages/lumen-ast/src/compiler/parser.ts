/**
 * Core Parser: prism-doc/2 to LumenDocumentAst Compiler
 */

import matter from 'gray-matter';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { directive } from 'micromark-extension-directive';
import { directiveFromMarkdown } from 'mdast-util-directive';
import { math } from 'micromark-extension-math';
import { mathFromMarkdown } from 'mdast-util-math';

import type { LumenDiagnostic } from '../ast/diagnostics.js';
import { createDiagnostic } from '../ast/diagnostics.js';
import type { LumenFrontmatter } from '../ast/frontmatter.js';
import { validateFrontmatter } from '../ast/frontmatter.js';
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

import { buildTableOfContents, extractHeadingIdAndTitle } from './headings.js';
import { parseJsxTag } from './jsx-parser.js';
import { splitTextWithSmartRefs, SMART_REF_PATTERN } from './smart-refs.js';
import {
  createAdmonitionNode,
  createMathEnvironmentNode,
  createTabItemNode,
  createTabsNode,
  isAdmonitionKind,
  preProcessDirectives,
  resolveDirectiveAttributes,
} from './directives.js';
import { isFormalMathEnv } from '../math/environments.js';
import type { MathEnvType } from '../math/environments.js';
import { MathNumberingEngine } from '../math/numbering.js';
import { generateMathAnchor } from '../math/anchors.js';

interface ParseContext {
  filePath?: string;
  attrMap: Map<string, Record<string, unknown>>;
  diagnostics: LumenDiagnostic[];
  numberingEngine: MathNumberingEngine;
  existingAnchors: Set<string>;
  mathIndex: number;
}

export async function parseDocument(content: string, filePath?: string): Promise<LumenDocumentAst> {
  const diagnostics: LumenDiagnostic[] = [];

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

  let parsedFrontmatter: LumenFrontmatter = {};
  let bodyContent = content;

  // 1. Split frontmatter safely
  try {
    const parsedMatter = matter(content);
    bodyContent = parsedMatter.content;
    const validated = validateFrontmatter(parsedMatter.data, filePath);
    parsedFrontmatter = validated.frontmatter;
    diagnostics.push(...validated.diagnostics);
  } catch (err) {
    diagnostics.push(
      createDiagnostic('FRONTMATTER_PARSE_ERROR', err instanceof Error ? err.message : String(err), 'error', {
        file: filePath,
        line: 1,
      })
    );

    // Fallback extraction of body content after unclosed or broken frontmatter fence
    if (content.startsWith('---')) {
      const closingIdx = content.indexOf('\n---\n', 3);
      if (closingIdx !== -1) {
        bodyContent = content.slice(closingIdx + 5);
      } else {
        const nextHeadingIdx = content.indexOf('\n#');
        if (nextHeadingIdx !== -1) {
          bodyContent = content.slice(nextHeadingIdx + 1);
        }
      }
    }
  }

  // 2. Build Table of Contents
  const lines = bodyContent.split('\n');
  const toc = buildTableOfContents(lines);

  // 3. Pre-process directives (masking attributes with unquoted arrays)
  const { processedContent, attrMap } = preProcessDirectives(bodyContent);

  // 4. Mask smart references: @domain:target -> @domain__LUMEN_COLON__target so micromark doesn't treat : as textDirective
  const maskedSmartRefs = processedContent.includes('@')
    ? processedContent.replace(
        new RegExp(SMART_REF_PATTERN.source, 'g'),
        (_, domain, target) => `@${domain}__LUMEN_COLON__${target}`
      )
    : processedContent;

  // 5. Parse Markdown with micromark & mdast extensions
  let mdastTree: { type: string; children?: unknown[] };
  try {
    mdastTree = fromMarkdown(maskedSmartRefs, {
      extensions: [gfm(), directive(), math()],
      mdastExtensions: [gfmFromMarkdown(), directiveFromMarkdown(), mathFromMarkdown()],
    }) as { type: string; children?: unknown[] };
  } catch (err) {
    diagnostics.push(
      createDiagnostic('MARKDOWN_PARSE_ERROR', err instanceof Error ? err.message : String(err), 'error', {
        file: filePath,
      })
    );
    mdastTree = { type: 'root', children: [] };
  }

  // 6. Transform mdast tree into typed LumenNode tree
  const context: ParseContext = {
    filePath,
    attrMap,
    diagnostics,
    numberingEngine: new MathNumberingEngine(),
    existingAnchors: new Set<string>(),
    mathIndex: 0,
  };

  const mdastChildren = ((mdastTree as any)['children'] ?? []) as Record<string, unknown>[];
  const transformedChildren: LumenNode[] = [];

  for (const child of mdastChildren) {
    const nodes = transformNode(child, context);
    if (Array.isArray(nodes)) {
      transformedChildren.push(...nodes);
    } else if (nodes) {
      transformedChildren.push(nodes);
    }
  }

  return {
    frontmatter: parsedFrontmatter,
    children: transformedChildren,
    toc,
    diagnostics,
    rawContent: bodyContent,
  };
}

function transformNode(rawNode: Record<string, unknown>, context: ParseContext): LumenNode | LumenNode[] {
  const node = rawNode as any;
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
      const depth = Number(node['depth'] ?? 1) as 1 | 2 | 3 | 4 | 5 | 6;
      const rawChildren = (node['children'] ?? []) as Record<string, unknown>[];
      const children = rawChildren.flatMap((c) => {
        const res = transformNode(c, context);
        return Array.isArray(res) ? res : [res];
      });

      // Extract plain text to compute heading id
      const fullText = children
        .map((c) => ('value' in c && typeof c['value'] === 'string' ? c['value'] : ''))
        .join(' ');
      const { id } = extractHeadingIdAndTitle(fullText, 1);

      return {
        type: 'heading',
        depth,
        id,
        children,
        position: node['position'],
      } as LumenHeadingNode;
    }

    case 'text': {
      const rawValue = String(node['value'] ?? '');
      if (!rawValue.includes('@')) {
        return [{ type: 'text', value: rawValue, position: node['position'] } as LumenNode];
      }
      // Unmask __LUMEN_COLON__ back to :
      const unmaskedValue = rawValue.includes('__LUMEN_COLON__')
        ? rawValue.replace(/@([a-zA-Z][\w-]*)__LUMEN_COLON__/g, '@$1:')
        : rawValue;
      return splitTextWithSmartRefs(unmaskedValue);
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
        context.mathIndex++;
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
            context.mathIndex,
            context.existingAnchors
          );
        }

        return createMathEnvironmentNode(mathEnvKind, resolvedAttrs, children);
      }

      // 2. Admonitions
      if (isAdmonitionKind(name)) {
        return createAdmonitionNode(name, resolvedAttrs, children);
      }

      // 3. Tabs & Tab Items
      if (name === 'tabs') {
        return createTabsNode(resolvedAttrs, children);
      }
      if (name === 'tab') {
        return createTabItemNode(resolvedAttrs, children);
      }

      // 4. Fallback Container
      return {
        type: 'containerDirective',
        name,
        attributes: resolvedAttrs,
        children,
        position: node['position'],
      };
    }

    case 'html': {
      const rawHtml = String(node['value'] ?? '');
      const { node: jsxNode, diagnostics: jsxDiagnostics } = parseJsxTag(rawHtml, context.filePath);
      context.diagnostics.push(...jsxDiagnostics);
      return jsxNode;
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
          ...rawNode,
          children,
        } as LumenNode;
      }
      return rawNode as LumenNode;
    }
  }
}
