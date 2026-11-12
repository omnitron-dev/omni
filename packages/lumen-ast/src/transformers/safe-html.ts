import { defaultSchema, sanitize, type Schema } from 'hast-util-sanitize';
import { toHtml } from 'hast-util-to-html';
import type { Element, Properties, Root } from 'hast';

const ISLAND_TAGS = new Set(['div', 'section', 'aside', 'span']);

/** Only containers admitted by the HTML policy can expose island content. */
export function isInteractiveHtmlElement(tagName: string, attributes: Record<string, unknown>): boolean {
  return ISLAND_TAGS.has(tagName) && (Object.hasOwn(attributes, 'dataLumenIsland') || Object.hasOwn(attributes, 'dataWidget'));
}

const schema: Schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'section', 'aside'],
  strip: [
    ...(defaultSchema.strip ?? []),
    'script',
    'style',
    'iframe',
    'svg',
    'math',
    'object',
    'embed',
    'template',
    'noscript',
    'textarea',
    'title',
    'xmp',
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'className', 'role', 'ariaLabel', 'dataAccess', 'access'],
    ...Object.fromEntries(
      [...ISLAND_TAGS].map((tag) => [
        tag,
        [
          ...(defaultSchema.attributes?.[tag] ?? []),
          'dataLumenIsland',
          'dataComponent',
          'dataHydrate',
          'dataProps',
          'dataAccess',
        ],
      ])
    ),
  },
};

/** Sanitize authored tag/attributes before attaching already-rendered safe children. */
export function renderSafeHtmlElement(
  tagName: string,
  attributes: Record<string, unknown>,
  renderedChildren: string
): string {
  const candidate: Element = { type: 'element', tagName, properties: attributes as Properties, children: [] };
  const tree = sanitize({ type: 'root', children: [candidate] } as Root, schema);
  if (tree.type !== 'root') return '';
  const safe = tree.children[0];
  if (safe?.type !== 'element') return '';
  safe.children = [{ type: 'raw', value: renderedChildren }];
  return toHtml(safe, { allowDangerousHtml: true });
}
