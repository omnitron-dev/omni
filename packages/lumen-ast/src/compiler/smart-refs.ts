/**
 * Smart Cross-Reference Tokenizer
 * Parses @<domain>:<target> syntax (e.g. @thm:spectral-decomp, @api:CorpusGraph#resolveAnchor)
 */

import type { LumenNode, LumenSmartRefNode, LumenTextNode } from '../ast/types.js';

export const SMART_REF_PATTERN =
  /@([a-zA-Z][\w-]*):((?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_./#~-]+?)(?=[,.:;!?"'()[\]{}]?(?:\s|$))/;

export function parseSmartRef(rawToken: string, domain: string, fullTarget: string): LumenSmartRefNode {
  let target = fullTarget;
  let symbol: string | undefined;
  let pkg: string | undefined;

  if (target.includes('#')) {
    const parts = target.split('#');
    target = parts[0] ?? target;
    symbol = parts[1];
  }

  if (target.startsWith('@')) {
    pkg = target;
  }

  return {
    type: 'smartRef',
    domain,
    target: fullTarget,
    symbol,
    package: pkg,
    raw: rawToken,
  };
}

export function splitTextWithSmartRefs(text: string): LumenNode[] {
  if (!text.includes('@')) {
    return [{ type: 'text', value: text } as LumenTextNode];
  }

  const result: LumenNode[] = [];
  const regex = new RegExp(SMART_REF_PATTERN.source, 'g');
  let lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const matchStart = match.index;
    const matchEnd = regex.lastIndex;

    // Push preceding text if any
    if (matchStart > lastIndex) {
      result.push({
        type: 'text',
        value: text.slice(lastIndex, matchStart),
      } as LumenTextNode);
    }

    const rawMatch = match[0] ?? '';
    const domain = match[1] ?? '';
    const fullTarget = match[2] ?? '';

    result.push(parseSmartRef(rawMatch, domain, fullTarget));
    lastIndex = matchEnd;
  }

  // Push trailing text if any
  if (lastIndex < text.length) {
    result.push({
      type: 'text',
      value: text.slice(lastIndex),
    } as LumenTextNode);
  }

  return result.length > 0 ? result : [{ type: 'text', value: text } as LumenTextNode];
}
