/**
 * Safe, Schema-Bound JSX Widget Parser (Zero Arbitrary Eval)
 */

import type { LumenDiagnostic } from '../ast/diagnostics.js';
import { createDiagnostic } from '../ast/diagnostics.js';
import type { LumenJsxWidgetNode, LumenNode, LumenRawHtmlPlaceholderNode } from '../ast/types.js';
import { parseAttributeString } from './lexer-attrs.js';

export function isPascalCaseTag(tagName: string): boolean {
  return /^[A-Z][A-Za-z0-9_]*$/.test(tagName);
}

export function parseJsxTag(
  htmlContent: string,
  filePath?: string
): { node: LumenJsxWidgetNode | LumenRawHtmlPlaceholderNode; diagnostics: LumenDiagnostic[] } {
  const diagnostics: LumenDiagnostic[] = [];
  const trimmed = htmlContent.trim();

  // Match self-closing tag: <Callout variant="info" />
  const selfClosingMatch = trimmed.match(/^<([A-Za-z0-9_]+)([\s\S]*?)\/>$/);
  if (selfClosingMatch) {
    const tagName = selfClosingMatch[1] ?? '';
    const rawAttrs = selfClosingMatch[2] ?? '';

    if (!isPascalCaseTag(tagName)) {
      return {
        node: { type: 'rawHtmlPlaceholder', raw: htmlContent },
        diagnostics,
      };
    }

    if (/\b(?:function|eval|window|document|process|globalThis|=>)\b/.test(rawAttrs)) {
      diagnostics.push(
        createDiagnostic(
          'UNSUPPORTED_JSX_EXPRESSION',
          `Dynamic JS expression disallowed in widget <${tagName}> props`,
          'error',
          { file: filePath }
        )
      );
    }

    const props = parseAttributeString(rawAttrs);
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

  // Match paired tag: <Callout variant="info">...</Callout>
  const pairedMatch = trimmed.match(/^<([A-Za-z0-9_]+)([\s\S]*?)>([\s\S]*?)<\/\1>$/);
  if (pairedMatch) {
    const tagName = pairedMatch[1] ?? '';
    const rawAttrs = pairedMatch[2] ?? '';
    const body = (pairedMatch[3] ?? '').trim();

    if (!isPascalCaseTag(tagName)) {
      return {
        node: { type: 'rawHtmlPlaceholder', raw: htmlContent },
        diagnostics,
      };
    }

    if (/\b(?:function|eval|window|document|process|globalThis|=>)\b/.test(rawAttrs)) {
      diagnostics.push(
        createDiagnostic(
          'UNSUPPORTED_JSX_EXPRESSION',
          `Dynamic JS expression disallowed in widget <${tagName}> props`,
          'error',
          { file: filePath }
        )
      );
    }

    const props = parseAttributeString(rawAttrs);
    const children: LumenNode[] = body ? [{ type: 'text', value: body }] : [];

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

  return {
    node: { type: 'rawHtmlPlaceholder', raw: htmlContent },
    diagnostics,
  };
}
