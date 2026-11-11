/**
 * AST-Based Schema-Bound JSX Widget Parser (TypeScript TSX AST, Zero Arbitrary Eval)
 */

import ts from 'typescript';

import type { LumenDiagnostic } from '../ast/diagnostics.js';
import { createDiagnostic } from '../ast/diagnostics.js';
import type { LumenJsxWidgetNode, LumenNode, LumenRawHtmlPlaceholderNode } from '../ast/types.js';

export function isPascalCaseTag(tagName: string): boolean {
  return /^[A-Z][A-Za-z0-9_]*$/.test(tagName);
}

const FORBIDDEN_PROP_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Scans from index `pos` (just after `<TagName`) to find the matching `/>` or `>`
 * of the opening JSX tag while respecting quotes, template literals, and `{...}` braces.
 */
export function scanJsxOpeningTagEnd(source: string, pos: number): { endIndex: number; selfClosing: boolean } | null {
  let i = pos;
  const len = source.length;
  let braceDepth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;

  while (i < len) {
    const ch = source[i]!;

    if (inSingle) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === "'") {
        inSingle = false;
      }
      i += 1;
      continue;
    }

    if (inDouble) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
      }
      i += 1;
      continue;
    }

    if (inTemplate) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '`') {
        inTemplate = false;
      }
      i += 1;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      i += 1;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      i += 1;
      continue;
    }

    if (ch === '{') {
      braceDepth += 1;
      i += 1;
      continue;
    }

    if (ch === '}') {
      if (braceDepth > 0) {
        braceDepth -= 1;
      }
      i += 1;
      continue;
    }

    if (braceDepth === 0) {
      if (ch === '/' && source[i + 1] === '>') {
        return { endIndex: i + 2, selfClosing: true };
      }
      if (ch === '>') {
        return { endIndex: i + 1, selfClosing: false };
      }
      if (ch === '<') {
        // Unexpected `<` outside quotes/braces inside opening tag
        return null;
      }
    }

    i += 1;
  }

  return null;
}

/**
 * Given `source` starting at `<TagName...`, extracts the complete self-closing or paired
 * PascalCase JSX element slice (handling nested tags of the same name).
 */
export function matchCompletePascalJsxElement(
  source: string,
  startIndex: number
): { endIndex: number; rawElement: string } | null {
  if (source[startIndex] !== '<') return null;
  const nameMatch = source.slice(startIndex + 1).match(/^([A-Z][A-Za-z0-9_]*)/);
  if (!nameMatch || !nameMatch[1]) return null;

  const tagName = nameMatch[1];
  const afterName = startIndex + 1 + tagName.length;
  const nextChar = source[afterName];
  if (nextChar !== undefined && !/[\s/>]/.test(nextChar)) {
    return null;
  }

  const openEnd = scanJsxOpeningTagEnd(source, afterName);
  if (!openEnd) return null;

  if (openEnd.selfClosing) {
    return {
      endIndex: openEnd.endIndex,
      rawElement: source.slice(startIndex, openEnd.endIndex),
    };
  }

  // Scan forward for matching </TagName> with nesting tracking
  let depth = 1;
  let i = openEnd.endIndex;
  const len = source.length;

  while (i < len && depth > 0) {
    const ch = source[i]!;

    // Skip fenced code blocks inside JSX children
    if ((i === 0 || source[i - 1] === '\n') && (source.startsWith('```', i) || source.startsWith('~~~', i))) {
      const fenceChar = source[i]!;
      let fenceLen = 0;
      while (source[i + fenceLen] === fenceChar) fenceLen += 1;
      const fence = fenceChar.repeat(fenceLen);
      const closeFenceIdx = source.indexOf(`\n${fence}`, i + fenceLen);
      if (closeFenceIdx === -1) return null;
      i = closeFenceIdx + 1 + fenceLen;
      continue;
    }

    // Skip inline code spans
    if (ch === '`') {
      const endTick = source.indexOf('`', i + 1);
      if (endTick !== -1) {
        i = endTick + 1;
        continue;
      }
    }

    if (ch === '<') {
      // Closing tag </TagName>
      if (source[i + 1] === '/') {
        const closeMatch = source.slice(i + 2).match(/^([A-Za-z0-9_]+)\s*>/);
        if (closeMatch && closeMatch[1] === tagName) {
          depth -= 1;
          i += 2 + closeMatch[0].length;
          if (depth === 0) {
            return {
              endIndex: i,
              rawElement: source.slice(startIndex, i),
            };
          }
          continue;
        }
      } else if (/[A-Z]/.test(source[i + 1] ?? '')) {
        const innerNameMatch = source.slice(i + 1).match(/^([A-Z][A-Za-z0-9_]*)/);
        if (innerNameMatch && innerNameMatch[1] === tagName) {
          const innerAfter = i + 1 + tagName.length;
          const innerNext = source[innerAfter];
          if (innerNext !== undefined && /[\s/>]/.test(innerNext)) {
            const innerOpen = scanJsxOpeningTagEnd(source, innerAfter);
            if (innerOpen) {
              if (!innerOpen.selfClosing) {
                depth += 1;
              }
              i = innerOpen.endIndex;
              continue;
            }
          }
        }
      }
    }

    i += 1;
  }

  return null;
}

/**
 * Masks top-level PascalCase JSX tags in Markdown into HTML comment placeholders
 * so CommonMark (`fromMarkdown`) never splits multi-line JSX or drops `{...}` attributes,
 * while ignoring fenced code blocks, inline code, and math spans.
 */
export function maskPascalJsxElements(content: string): {
  maskedContent: string;
  jsxMap: Map<string, string>;
} {
  const jsxMap = new Map<string, string>();
  if (!content.includes('<')) {
    return { maskedContent: content, jsxMap };
  }

  let out = '';
  let i = 0;
  let counter = 0;
  const len = content.length;

  while (i < len) {
    // 1. Fenced code block at start of line
    if (i === 0 || content[i - 1] === '\n') {
      const lineFenceMatch = content.slice(i).match(/^( {0,3})(`{3,}|~{3,})([^\n]*)\n/);
      if (lineFenceMatch && lineFenceMatch[2]) {
        const fence = lineFenceMatch[2];
        const fenceChar = fence[0]!;
        const headerLen = lineFenceMatch[0].length;
        let cursor = i + headerLen;
        let closedEnd = len;

        while (cursor < len) {
          const nl = content.indexOf('\n', cursor);
          const lineEnd = nl === -1 ? len : nl;
          const lineText = content.slice(cursor, lineEnd).trim();
          if (lineText.startsWith(fence) && [...lineText].every((c) => c === fenceChar)) {
            closedEnd = nl === -1 ? len : nl + 1;
            break;
          }
          if (nl === -1) break;
          cursor = nl + 1;
        }

        out += content.slice(i, closedEnd);
        i = closedEnd;
        continue;
      }
    }

    const ch = content[i]!;

    // 2. Inline code span
    if (ch === '`') {
      let tickCount = 0;
      while (content[i + tickCount] === '`') tickCount += 1;
      const ticks = '`'.repeat(tickCount);
      const closeIdx = content.indexOf(ticks, i + tickCount);
      if (closeIdx !== -1) {
        out += content.slice(i, closeIdx + tickCount);
        i = closeIdx + tickCount;
        continue;
      }
      out += ticks;
      i += tickCount;
      continue;
    }

    // 3. Math spans $$...$$ or $...$
    if (ch === '$' && (i === 0 || content[i - 1] !== '\\')) {
      if (content[i + 1] === '$') {
        const closeMath = content.indexOf('$$', i + 2);
        if (closeMath !== -1) {
          out += content.slice(i, closeMath + 2);
          i = closeMath + 2;
          continue;
        }
      } else {
        const closeInlineMath = content.indexOf('$', i + 1);
        const nextNl = content.indexOf('\n', i + 1);
        if (closeInlineMath !== -1 && (nextNl === -1 || closeInlineMath < nextNl)) {
          out += content.slice(i, closeInlineMath + 1);
          i = closeInlineMath + 1;
          continue;
        }
      }
    }

    // 4. HTML comments <!-- ... -->
    if (ch === '<' && content.startsWith('<!--', i)) {
      const closeComment = content.indexOf('-->', i + 4);
      if (closeComment !== -1) {
        out += content.slice(i, closeComment + 3);
        i = closeComment + 3;
        continue;
      }
    }

    // 5. PascalCase JSX element
    if (ch === '<' && /[A-Z]/.test(content[i + 1] ?? '') && (i === 0 || content[i - 1] !== '\\')) {
      const matched = matchCompletePascalJsxElement(content, i);
      if (matched) {
        const token = `__LUMEN_JSX_TOKEN_${counter++}__`;
        jsxMap.set(token, matched.rawElement);
        out += `<!--${token}-->`;
        i = matched.endIndex;
        continue;
      }
    }

    out += ch;
    i += 1;
  }

  return { maskedContent: out, jsxMap };
}

function evaluateStaticAstExpression(
  expr: ts.Expression,
  sourceFile: ts.SourceFile,
  tagName: string,
  propName: string,
  filePath: string | undefined,
  diagnostics: LumenDiagnostic[]
): { ok: true; value: unknown } | { ok: false } {
  if (ts.isParenthesizedExpression(expr)) {
    return evaluateStaticAstExpression(expr.expression, sourceFile, tagName, propName, filePath, diagnostics);
  }

  if (ts.isNumericLiteral(expr)) {
    return { ok: true, value: Number(expr.text) };
  }

  if (
    ts.isPrefixUnaryExpression(expr) &&
    (expr.operator === ts.SyntaxKind.MinusToken || expr.operator === ts.SyntaxKind.PlusToken) &&
    ts.isNumericLiteral(expr.operand)
  ) {
    const num = Number(expr.operand.text);
    return { ok: true, value: expr.operator === ts.SyntaxKind.MinusToken ? -num : num };
  }

  if (expr.kind === ts.SyntaxKind.TrueKeyword) {
    return { ok: true, value: true };
  }

  if (expr.kind === ts.SyntaxKind.FalseKeyword) {
    return { ok: true, value: false };
  }

  if (expr.kind === ts.SyntaxKind.NullKeyword) {
    return { ok: true, value: null };
  }

  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return { ok: true, value: expr.text };
  }

  if (ts.isArrayLiteralExpression(expr)) {
    const arr: unknown[] = [];
    for (const el of expr.elements) {
      if (ts.isSpreadElement(el) || ts.isOmittedExpression(el)) {
        diagnostics.push(
          createDiagnostic(
            'JSX_UNSAFE_EXPRESSION',
            `Dynamic array element disallowed in widget <${tagName}> prop "${propName}"`,
            'error',
            { file: filePath }
          )
        );
        return { ok: false };
      }
      const evaluated = evaluateStaticAstExpression(el, sourceFile, tagName, propName, filePath, diagnostics);
      if (!evaluated.ok) {
        return { ok: false };
      }
      arr.push(evaluated.value);
    }
    return { ok: true, value: arr };
  }

  if (ts.isObjectLiteralExpression(expr)) {
    const obj: Record<string, unknown> = {};
    for (const prop of expr.properties) {
      if (!ts.isPropertyAssignment(prop)) {
        diagnostics.push(
          createDiagnostic(
            'JSX_UNSAFE_EXPRESSION',
            `Dynamic object property disallowed in widget <${tagName}> prop "${propName}"`,
            'error',
            { file: filePath }
          )
        );
        return { ok: false };
      }

      let keyName: string | null = null;
      if (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) || ts.isNumericLiteral(prop.name)) {
        keyName = prop.name.text;
      }

      if (!keyName || FORBIDDEN_PROP_KEYS.has(keyName)) {
        diagnostics.push(
          createDiagnostic(
            'JSX_UNSAFE_EXPRESSION',
            `Computed or forbidden object key disallowed in widget <${tagName}> prop "${propName}"`,
            'error',
            { file: filePath }
          )
        );
        return { ok: false };
      }

      const evaluated = evaluateStaticAstExpression(
        prop.initializer,
        sourceFile,
        tagName,
        propName,
        filePath,
        diagnostics
      );
      if (!evaluated.ok) {
        return { ok: false };
      }
      obj[keyName] = evaluated.value;
    }
    return { ok: true, value: obj };
  }

  diagnostics.push(
    createDiagnostic(
      'JSX_UNSAFE_EXPRESSION',
      `Dynamic JS expression (${ts.SyntaxKind[expr.kind]}) disallowed in widget <${tagName}> prop "${propName}"`,
      'error',
      { file: filePath }
    )
  );
  return { ok: false };
}

function parseOpeningTagPropsViaTsAst(
  selfClosingTagSource: string,
  tagName: string,
  filePath: string | undefined,
  diagnostics: LumenDiagnostic[]
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const wrapped = `const __lumen_jsx = (\n${selfClosingTagSource}\n);`;
  const sourceFile = ts.createSourceFile('__jsx.tsx', wrapped, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const parseDiags = (sourceFile as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics;
  if (Array.isArray(parseDiags) && parseDiags.length > 0) {
    diagnostics.push(
      createDiagnostic('JSX_UNSAFE_EXPRESSION', `Invalid or unsafe JSX syntax in widget <${tagName}>`, 'error', {
        file: filePath,
      })
    );
    return props;
  }

  let jsxElement: ts.JsxSelfClosingElement | ts.JsxOpeningElement | null = null;
  const visit = (node: ts.Node) => {
    if (jsxElement) return;
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      jsxElement = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (!jsxElement) {
    return props;
  }

  const attributes = (jsxElement as ts.JsxSelfClosingElement).attributes.properties;
  for (const attr of attributes) {
    if (ts.isJsxSpreadAttribute(attr)) {
      diagnostics.push(
        createDiagnostic('JSX_UNSAFE_EXPRESSION', `JSX spread attribute disallowed in widget <${tagName}>`, 'error', {
          file: filePath,
        })
      );
      continue;
    }

    if (ts.isJsxAttribute(attr)) {
      const attrName = attr.name.getText(sourceFile);
      if (FORBIDDEN_PROP_KEYS.has(attrName)) {
        continue;
      }

      if (!attr.initializer) {
        props[attrName] = true;
        continue;
      }

      if (ts.isStringLiteral(attr.initializer)) {
        props[attrName] = attr.initializer.text;
        continue;
      }

      if (ts.isJsxExpression(attr.initializer)) {
        if (!attr.initializer.expression) {
          diagnostics.push(
            createDiagnostic(
              'JSX_UNSAFE_EXPRESSION',
              `Empty JSX expression disallowed in widget <${tagName}> prop "${attrName}"`,
              'error',
              { file: filePath }
            )
          );
          continue;
        }

        const evaluated = evaluateStaticAstExpression(
          attr.initializer.expression,
          sourceFile,
          tagName,
          attrName,
          filePath,
          diagnostics
        );
        if (evaluated.ok) {
          props[attrName] = evaluated.value;
        }
      }
    }
  }

  return props;
}

export function dedentJsxInnerContent(raw: string): string {
  const normalized = raw.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  // Trim leading and trailing blank-only lines
  while (lines.length > 0 && lines[0]!.trim() === '') {
    lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') {
    lines.pop();
  }
  if (lines.length === 0) return '';

  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const match = line.match(/^[ \t]*/);
    const indent = match ? match[0].length : 0;
    if (indent < minIndent) {
      minIndent = indent;
    }
  }

  if (!Number.isFinite(minIndent) || minIndent === 0) {
    return lines.join('\n');
  }

  return lines.map((line) => (line.trim().length === 0 ? '' : line.slice(minIndent))).join('\n');
}

export type InnerFragmentParser = (
  markdown: string,
  filePath?: string
) => { children: LumenNode[]; diagnostics: LumenDiagnostic[] };

let registeredFragmentParser: InnerFragmentParser | null = null;

export function registerJsxFragmentParser(parser: InnerFragmentParser): void {
  registeredFragmentParser = parser;
}

export function parseJsxTag(
  htmlContent: string,
  filePath?: string,
  fragmentParser?: InnerFragmentParser
): { node: LumenJsxWidgetNode | LumenRawHtmlPlaceholderNode; diagnostics: LumenDiagnostic[] } {
  const diagnostics: LumenDiagnostic[] = [];
  const trimmed = htmlContent.trim();

  if (!trimmed.startsWith('<')) {
    return {
      node: { type: 'rawHtmlPlaceholder', raw: htmlContent },
      diagnostics,
    };
  }

  const tagMatch = trimmed.slice(1).match(/^([A-Za-z0-9_]+)/);
  const tagName = tagMatch?.[1] ?? '';

  if (!tagName || !isPascalCaseTag(tagName)) {
    return {
      node: { type: 'rawHtmlPlaceholder', raw: htmlContent },
      diagnostics,
    };
  }

  const afterName = 1 + tagName.length;
  const nextChar = trimmed[afterName];
  if (nextChar !== undefined && !/[\s/>]/.test(nextChar)) {
    return {
      node: { type: 'rawHtmlPlaceholder', raw: htmlContent },
      diagnostics,
    };
  }

  const openEnd = scanJsxOpeningTagEnd(trimmed, afterName);
  if (!openEnd) {
    return {
      node: { type: 'rawHtmlPlaceholder', raw: htmlContent },
      diagnostics,
    };
  }

  // Case 1: Self-closing <Widget ... />
  if (openEnd.selfClosing && openEnd.endIndex === trimmed.length) {
    const props = parseOpeningTagPropsViaTsAst(trimmed, tagName, filePath, diagnostics);
    return {
      node: {
        type: 'jsxWidget',
        name: tagName,
        props,
        isSelfClosing: true,
      },
      diagnostics,
    };
  }

  // Case 2: Paired <Widget ...>...</Widget>
  if (!openEnd.selfClosing) {
    const closingSuffix = new RegExp(`</${tagName}\\s*>$`);
    const closeMatch = closingSuffix.exec(trimmed);
    if (closeMatch && closeMatch.index >= openEnd.endIndex) {
      const openSliceWithoutGt = trimmed.slice(0, openEnd.endIndex - 1);
      const syntheticSelfClosing = `${openSliceWithoutGt} />`;
      const props = parseOpeningTagPropsViaTsAst(syntheticSelfClosing, tagName, filePath, diagnostics);

      const rawBody = trimmed.slice(openEnd.endIndex, closeMatch.index);
      const dedented = dedentJsxInnerContent(rawBody);

      let children: LumenNode[] = [];
      const activeParser = fragmentParser ?? registeredFragmentParser;
      if (dedented) {
        if (activeParser) {
          const parsedInner = activeParser(dedented, filePath);
          children = parsedInner.children;
          diagnostics.push(...parsedInner.diagnostics);
        } else {
          children = [{ type: 'text', value: dedented }];
        }
      }

      return {
        node: {
          type: 'jsxWidget',
          name: tagName,
          props,
          isSelfClosing: false,
          children,
        },
        diagnostics,
      };
    }
  }

  return {
    node: { type: 'rawHtmlPlaceholder', raw: htmlContent },
    diagnostics,
  };
}
