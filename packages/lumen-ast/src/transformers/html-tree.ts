import type { Element, ElementContent, Properties, Text } from 'hast';
import type { LumenExampleSource } from '../ast/types.js';

/** Trusted semantic annotations. Authored HTML attributes never populate this field. */
export type LumenRenderMetadata =
  | { kind: 'widget'; name: string; props: Record<string, unknown>; ordinal: number }
  | { kind: 'example'; source: LumenExampleSource & { code: string; language: string }; ordinal: number };

declare module 'hast' {
  interface ElementData {
    lumen?: LumenRenderMetadata;
  }
}

export function element(tagName: string, properties: Properties = {}, children: ElementContent[] = []): Element {
  return { type: 'element', tagName, properties, children };
}

export function text(value: string): Text {
  return { type: 'text', value };
}
