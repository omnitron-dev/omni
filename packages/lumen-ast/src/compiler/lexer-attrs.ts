/**
 * Safe, Zero-Eval Attribute Lexer for Directives and JSX Widgets
 */

export function parseAttributeString(input: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (!input) return result;

  const trimmed = input.trim();
  // Strip outer { and } if present (e.g. {id="thm-purity" title="..."})
  const content = trimmed.startsWith('{') && trimmed.endsWith('}') ? trimmed.slice(1, -1).trim() : trimmed;

  let i = 0;
  const len = content.length;

  function skipWhitespace() {
    while (i < len && /\s/.test(content[i]!)) i++;
  }

  function readKey(): string {
    skipWhitespace();
    const start = i;
    while (i < len && /[a-zA-Z0-9_#@:.-]/.test(content[i]!)) {
      i++;
    }
    return content.slice(start, i);
  }

  function parseValue(): unknown {
    skipWhitespace();
    if (i >= len) return true;

    const char = content[i];

    // String: double quotes
    if (char === '"') {
      i++;
      let val = '';
      while (i < len) {
        if (content[i] === '\\' && i + 1 < len) {
          val += content[i + 1];
          i += 2;
        } else if (content[i] === '"') {
          i++;
          break;
        } else {
          val += content[i];
          i++;
        }
      }
      return val;
    }

    // String: single quotes
    if (char === "'") {
      i++;
      let val = '';
      while (i < len) {
        if (content[i] === '\\' && i + 1 < len) {
          val += content[i + 1];
          i += 2;
        } else if (content[i] === "'") {
          i++;
          break;
        } else {
          val += content[i];
          i++;
        }
      }
      return val;
    }

    // Array: [...]
    if (char === '[') {
      i++; // consume [
      const items: unknown[] = [];
      while (i < len) {
        skipWhitespace();
        if (content[i] === ']') {
          i++;
          break;
        }
        const itemVal = parseValue();
        items.push(itemVal);
        skipWhitespace();
        if (content[i] === ',') {
          i++;
        } else if (content[i] === ']') {
          i++;
          break;
        }
      }
      return items;
    }

    // Object or JSX expression: {...}
    if (char === '{') {
      i++; // consume {
      skipWhitespace();
      // Nested object or JSX expression inside braces
      // Check if it's a nested object key-value or literal
      let depth = 1;
      const start = i;
      while (i < len && depth > 0) {
        if (content[i] === '{') depth++;
        else if (content[i] === '}') depth--;
        i++;
      }
      const inner = content.slice(start, i - 1).trim();

      // Literal boolean / number / string inside JSX {}
      if (inner === 'true') return true;
      if (inner === 'false') return false;
      if (/^-?\d+(\.\d+)?$/.test(inner)) return Number(inner);
      if ((inner.startsWith('"') && inner.endsWith('"')) || (inner.startsWith("'") && inner.endsWith("'"))) {
        return inner.slice(1, -1);
      }
      if (inner.startsWith('[') && inner.endsWith(']')) {
        return parseAttributeString(inner)['items'] ?? [];
      }
      if (inner.includes(':')) {
        // Nested object literal: parse as key-values
        return parseObjectContent(inner);
      }
      return inner;
    }

    // Bare number, boolean, or identifier
    const start = i;
    while (i < len && !/[\s,}\]]/.test(content[i]!)) {
      i++;
    }
    const token = content.slice(start, i);
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
    return token;
  }

  function parseObjectContent(objContent: string): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    const pairs = objContent.split(',');
    for (const pair of pairs) {
      const idx = pair.indexOf(':');
      if (idx !== -1) {
        const k = pair
          .slice(0, idx)
          .trim()
          .replace(/^['"]|['"]$/g, '');
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

  while (i < len) {
    skipWhitespace();
    if (i >= len) break;
    const key = readKey();
    if (!key) {
      i++;
      continue;
    }

    skipWhitespace();
    if (i < len && content[i] === '=') {
      i++; // consume =
      const val = parseValue();
      result[key] = val;
    } else {
      // Boolean shorthand attribute (e.g. unnumbered, disabled)
      result[key] = true;
    }

    skipWhitespace();
    if (i < len && (content[i] === ',' || content[i] === ' ')) {
      i++;
    }
  }

  return result;
}
