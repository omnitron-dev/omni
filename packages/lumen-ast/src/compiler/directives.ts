/**
 * Directive Pre-Processing and Container Mapping
 */

import { MAX_ATTRIBUTE_STRING_LENGTH, parseAttributeString } from './lexer-attrs.js';
import { parseDirectiveAttributes } from '../math/environments.js';
import type { MathEnvType } from '../math/environments.js';
import type {
  AdmonitionKind,
  LumenAdmonitionNode,
  LumenMathEnvironmentNode,
  LumenNode,
  LumenTabItemNode,
  LumenTabsNode,
} from '../ast/types.js';

export const ADMONITION_KINDS = ['note', 'tip', 'warning', 'danger', 'info', 'caution'] as const;

export function isAdmonitionKind(kind: string): kind is AdmonitionKind {
  return (ADMONITION_KINDS as readonly string[]).includes(kind);
}

export interface DirectivePreProcessResult {
  processedContent: string;
  attrMap: Map<string, Record<string, unknown>>;
}

export function preProcessDirectives(content: string): DirectivePreProcessResult {
  const attrMap = new Map<string, Record<string, unknown>>();
  if (!content.includes(':::')) {
    return { processedContent: content, attrMap };
  }
  let counter = 0;

  // First pass: normalize nested :::tabs so outer tabs container fence has 4 colons
  const normalizedTabs = normalizeTabsDirectives(content);

  // Second pass: mask complex attributes containing [ or nested {
  const lines = normalizedTabs.split('\n');
  const processedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.length > MAX_ATTRIBUTE_STRING_LENGTH * 2 || !line.startsWith(':::')) {
      processedLines.push(line);
      continue;
    }
    // Look for lines like :::theorem{id="thm-1" dependsOn=["a", "b"]}
    const match = line.match(/^(:::{1,}\s*)([a-zA-Z0-9_-]+)(\{[^\n]*\})(.*)$/);
    if (match) {
      const prefix = match[1] ?? ':::';
      const dirName = match[2] ?? '';
      const rawAttrs = match[3] ?? '';
      const suffix = match[4] ?? '';

      // Only mask if attributes contain unquoted brackets/braces that micromark rejects
      if (rawAttrs.includes('[') || rawAttrs.includes('{', 1)) {
        const token = `__dir_token_${counter++}__`;
        const parsed = parseAttributeString(rawAttrs);
        attrMap.set(token, parsed);

        // Replace with {#token} padded with spaces to the exact same length
        const baseToken = `{#${token}}`;
        const paddedToken = baseToken.length <= rawAttrs.length ? baseToken.padEnd(rawAttrs.length, ' ') : baseToken;

        processedLines.push(`${prefix}${dirName}${paddedToken}${suffix}`);
        continue;
      }
    }
    processedLines.push(line);
  }

  return {
    processedContent: processedLines.join('\n'),
    attrMap,
  };
}

function normalizeTabsDirectives(content: string): string {
  const lines = content.split('\n');

  // Pass 1: find max tabs nesting depth
  let currentTabsDepth = 0;
  let maxTabsDepth = 0;

  interface DirectiveStackItem {
    type: string;
    tabsLevel?: number;
  }

  const stack: DirectiveStackItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const dirMatch = line.match(/^(:{3,})([a-zA-Z0-9_-]+)(\b.*)$/);
    if (dirMatch) {
      const name = dirMatch[2] ?? '';
      if (name === 'tabs') {
        currentTabsDepth++;
        if (currentTabsDepth > maxTabsDepth) {
          maxTabsDepth = currentTabsDepth;
        }
        stack.push({ type: 'tabs', tabsLevel: currentTabsDepth });
      } else if (name === 'tab') {
        stack.push({ type: 'tab', tabsLevel: currentTabsDepth });
      } else {
        stack.push({ type: 'other' });
      }
      continue;
    }

    const closeMatch = line.match(/^(:{3,})\s*$/);
    if (closeMatch) {
      const popped = stack.pop();
      if (popped && popped.type === 'tabs') {
        currentTabsDepth = Math.max(0, currentTabsDepth - 1);
      }
    }
  }

  if (maxTabsDepth === 0) {
    return content;
  }

  // Helper to compute colons:
  // For tabs at tabsLevel (1-based, 1 is outermost):
  // tabs colons: 2 * (maxTabsDepth - tabsLevel) + 4
  // tab colons: 2 * (maxTabsDepth - tabsLevel) + 3
  const getTabsColons = (level: number) => ':'.repeat(2 * (maxTabsDepth - level) + 4);
  const getTabColons = (level: number) => ':'.repeat(2 * (maxTabsDepth - level) + 3);

  // Pass 2: rewrite opening and closing fences for tabs and tab
  const result: string[] = [];
  const renderStack: Array<{ type: string; colons: string }> = [];
  let curTabsLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const dirMatch = line.match(/^(:{3,})([a-zA-Z0-9_-]+)(\b.*)$/);
    if (dirMatch) {
      const name = dirMatch[2] ?? '';
      const suffix = dirMatch[3] ?? '';
      if (name === 'tabs') {
        curTabsLevel++;
        const colons = getTabsColons(curTabsLevel);
        renderStack.push({ type: 'tabs', colons });
        result.push(colons + name + suffix);
        continue;
      } else if (name === 'tab') {
        const colons = getTabColons(curTabsLevel);
        renderStack.push({ type: 'tab', colons });
        result.push(colons + name + suffix);
        continue;
      } else {
        renderStack.push({ type: 'other', colons: dirMatch[1] ?? ':::' });
        result.push(line);
        continue;
      }
    }

    const closeMatch = line.match(/^(:{3,})\s*$/);
    if (closeMatch) {
      const popped = renderStack.pop();
      if (popped) {
        if (popped.type === 'tabs') {
          curTabsLevel = Math.max(0, curTabsLevel - 1);
          result.push(popped.colons);
          continue;
        } else if (popped.type === 'tab') {
          result.push(popped.colons);
          continue;
        }
      }
    }

    result.push(line);
  }

  return result.join('\n');
}

export function resolveDirectiveAttributes(
  rawAttributes: Record<string, unknown> | undefined,
  attrMap: Map<string, Record<string, unknown>>
): Record<string, unknown> {
  if (!rawAttributes) return {};
  const id = String(rawAttributes['id'] ?? '');
  if (id && attrMap.has(id)) {
    return { ...attrMap.get(id) };
  }
  return { ...rawAttributes };
}

export function createMathEnvironmentNode(
  envKind: MathEnvType,
  attrs: Record<string, unknown>,
  children: LumenNode[]
): LumenMathEnvironmentNode {
  const parsed = parseDirectiveAttributes(attrs);
  const access = typeof attrs['access'] === 'string' ? attrs['access'] : undefined;
  return {
    type: 'mathEnvironment',
    envKind,
    id: parsed.id,
    title: parsed.title,
    status: parsed.status,
    dependsOn: parsed.dependsOn,
    proves: parsed.proves,
    number: parsed.number,
    unnumbered: parsed.unnumbered,
    of: parsed.of,
    access,
    attributes: { ...attrs },
    children,
  };
}

export function createAdmonitionNode(
  kind: AdmonitionKind,
  attrs: Record<string, unknown>,
  children: LumenNode[]
): LumenAdmonitionNode {
  const rawTitle = attrs['title'];
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : capitalize(kind);
  const access = typeof attrs['access'] === 'string' ? attrs['access'] : undefined;
  return {
    type: 'admonition',
    kind,
    title,
    access,
    attributes: { ...attrs },
    children,
  };
}

export function createTabsNode(attrs: Record<string, unknown>, children: LumenNode[]): LumenTabsNode {
  const rawSyncKey = attrs['syncKey'];
  const syncKey = typeof rawSyncKey === 'string' ? rawSyncKey.trim() : undefined;
  const access = typeof attrs['access'] === 'string' ? attrs['access'] : undefined;
  const tabItems = children.filter((c): c is LumenTabItemNode => c.type === 'tabItem');
  return {
    type: 'tabs',
    syncKey,
    access,
    attributes: { ...attrs },
    children: tabItems,
  };
}

export function createTabItemNode(attrs: Record<string, unknown>, children: LumenNode[]): LumenTabItemNode {
  const rawLabel = attrs['label'];
  const rawValue = attrs['value'];
  const label = typeof rawLabel === 'string' ? rawLabel.trim() : typeof rawValue === 'string' ? rawValue.trim() : 'Tab';
  const value = typeof rawValue === 'string' ? rawValue.trim() : undefined;
  const access = typeof attrs['access'] === 'string' ? attrs['access'] : undefined;
  return {
    type: 'tabItem',
    label,
    value,
    access,
    attributes: { ...attrs },
    children,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
