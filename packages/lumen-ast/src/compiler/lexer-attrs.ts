/**
 * Safe, Zero-Eval Attribute Lexer for Directives and JSX Widgets
 * Enforces strict O(N) forward cursor progress, nesting depth cap, and prototype-pollution blocking.
 */

export const MAX_ATTRIBUTE_STRING_LENGTH = 16_384;
export const MAX_ATTRIBUTE_DEPTH = 16;

const FORBIDDEN_ATTR_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function parseAttributeString(input: string): Record<string, unknown> {
  return parseAttributeStringInternal(input, 0);
}

function parseAttributeStringInternal(input: string, depth: number): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (!input || typeof input !== 'string' || depth > MAX_ATTRIBUTE_DEPTH) {
    return result;
  }

  const bounded = input.length > MAX_ATTRIBUTE_STRING_LENGTH ? input.slice(0, MAX_ATTRIBUTE_STRING_LENGTH) : input;
  const trimmed = bounded.trim();
  if (!trimmed) {
    return result;
  }

  // Strip outer { and } only when balanced as an outer wrapper (e.g. {id="thm-purity" title="..."})
  const content =
    trimmed.startsWith('{') && trimmed.endsWith('}')
      ? trimmed.slice(1, -1).trim()
      : trimmed.startsWith('{')
        ? trimmed.slice(1).trim()
        : trimmed;

  let cursor = 0;
  const len = content.length;

  function skipWhitespace(): void {
    while (cursor < len && /\s/.test(content[cursor]!)) {
      cursor += 1;
    }
  }

  function readKey(): string {
    skipWhitespace();
    const start = cursor;
    while (cursor < len && /[a-zA-Z0-9_#@:.-]/.test(content[cursor]!)) {
      cursor += 1;
    }
    return content.slice(start, cursor);
  }

  function parseObjectContent(objContent: string, nextDepth: number): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    if (nextDepth > MAX_ATTRIBUTE_DEPTH) {
      return obj;
    }
    const pairs = objContent.split(',');
    for (const pair of pairs) {
      const idx = pair.indexOf(':');
      if (idx !== -1) {
        const k = pair
          .slice(0, idx)
          .trim()
          .replace(/^['"]|['"]$/g, '');
        if (!k || FORBIDDEN_ATTR_KEYS.has(k)) {
          continue;
        }
        const v = pair
          .slice(idx + 1)
          .trim()
          .replace(/^['"]|['"]$/g, '');
        if (v === 'true') obj[k] = true;
        else if (v === 'false') obj[k] = false;
        else if (/^-?\d+(\.\d+)?$/.test(v)) obj[k] = Number(v);
        else obj[k] = v;
      }
    }
    return obj;
  }

  function parseValue(currentDepth: number): unknown {
    skipWhitespace();
    if (cursor >= len) return true;

    if (currentDepth > MAX_ATTRIBUTE_DEPTH) {
      // Depth budget exhausted: consume remaining non-whitespace token safely without recursion
      const fallbackStart = cursor;
      while (cursor < len && !/\s/.test(content[cursor]!)) {
        cursor += 1;
      }
      if (cursor <= fallbackStart) {
        cursor = fallbackStart + 1;
      }
      return undefined;
    }

    const char = content[cursor];

    // String: double quotes
    if (char === '"') {
      cursor += 1;
      let val = '';
      while (cursor < len) {
        const prevCursor = cursor;
        if (content[cursor] === '\\' && cursor + 1 < len) {
          val += content[cursor + 1];
          cursor += 2;
        } else if (content[cursor] === '"') {
          cursor += 1;
          break;
        } else {
          val += content[cursor];
          cursor += 1;
        }
        if (cursor <= prevCursor) {
          cursor = prevCursor + 1;
        }
      }
      return val;
    }

    // String: single quotes
    if (char === "'") {
      cursor += 1;
      let val = '';
      while (cursor < len) {
        const prevCursor = cursor;
        if (content[cursor] === '\\' && cursor + 1 < len) {
          val += content[cursor + 1];
          cursor += 2;
        } else if (content[cursor] === "'") {
          cursor += 1;
          break;
        } else {
          val += content[cursor];
          cursor += 1;
        }
        if (cursor <= prevCursor) {
          cursor = prevCursor + 1;
        }
      }
      return val;
    }

    // Array: [...]
    if (char === '[') {
      cursor += 1; // consume [
      const items: unknown[] = [];
      while (cursor < len) {
        const prevCursor = cursor;
        skipWhitespace();
        if (cursor >= len) break;

        if (content[cursor] === ']') {
          cursor += 1;
          break;
        }
        if (content[cursor] === ',' || content[cursor] === '}') {
          cursor += 1;
          continue;
        }

        const itemVal = parseValue(currentDepth + 1);
        if (itemVal !== undefined) {
          items.push(itemVal);
        }
        skipWhitespace();
        if (cursor < len && content[cursor] === ',') {
          cursor += 1;
        } else if (cursor < len && content[cursor] === ']') {
          cursor += 1;
          break;
        }

        if (cursor <= prevCursor) {
          cursor = prevCursor + 1;
        }
      }
      return items;
    }

    // Object or JSX expression: {...}
    if (char === '{') {
      cursor += 1; // consume {
      skipWhitespace();
      let braceDepth = 1;
      const start = cursor;
      while (cursor < len && braceDepth > 0) {
        const prevCursor = cursor;
        if (content[cursor] === '{') braceDepth += 1;
        else if (content[cursor] === '}') braceDepth -= 1;
        cursor += 1;
        if (cursor <= prevCursor) {
          cursor = prevCursor + 1;
        }
      }
      const endOffset = braceDepth === 0 ? cursor - 1 : cursor;
      const inner = content.slice(start, endOffset).trim();

      if (inner === 'true') return true;
      if (inner === 'false') return false;
      if (/^-?\d+(\.\d+)?$/.test(inner)) return Number(inner);
      if ((inner.startsWith('"') && inner.endsWith('"')) || (inner.startsWith("'") && inner.endsWith("'"))) {
        return inner.slice(1, -1);
      }
      if (inner.startsWith('[') && inner.endsWith(']')) {
        const nested = parseAttributeStringInternal(`items=${inner}`, currentDepth + 1);
        return nested['items'] ?? [];
      }
      if (inner.includes(':')) {
        return parseObjectContent(inner, currentDepth + 1);
      }
      return inner;
    }

    // Bare number, boolean, or identifier
    const start = cursor;
    while (cursor < len && !/[\s,}\]]/.test(content[cursor]!)) {
      cursor += 1;
    }
    if (cursor === start) {
      // Unexpected delimiter at value start: consume 1 char to guarantee progress
      cursor += 1;
      return undefined;
    }
    const token = content.slice(start, cursor);
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
    return token;
  }

  while (cursor < len) {
    const prevCursor = cursor;
    skipWhitespace();
    if (cursor >= len) break;

    const key = readKey();
    if (!key) {
      cursor += 1;
      continue;
    }

    skipWhitespace();
    if (cursor < len && content[cursor] === '=') {
      cursor += 1; // consume =
      const val = parseValue(depth + 1);
      if (!FORBIDDEN_ATTR_KEYS.has(key) && val !== undefined) {
        result[key] = val;
      }
    } else if (!FORBIDDEN_ATTR_KEYS.has(key)) {
      // Boolean shorthand attribute (e.g. unnumbered, disabled)
      result[key] = true;
    }

    skipWhitespace();
    if (cursor < len && (content[cursor] === ',' || content[cursor] === ' ')) {
      cursor += 1;
    }

    if (cursor <= prevCursor) {
      cursor = prevCursor + 1;
    }
  }

  return result;
}
