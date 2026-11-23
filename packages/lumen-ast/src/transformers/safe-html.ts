import { defaultSchema, sanitize, type Schema } from 'hast-util-sanitize';
import type { Element, Properties, Root } from 'hast';
import { element } from './html-tree.js';

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

/** Sanitize the element in its real placement before rendering its children. */
export function safeHtmlElement(
  tagName: string,
  attributes: Record<string, unknown>,
  ancestors: readonly string[]
): Element | undefined {
  const candidate = element(tagName, attributes as Properties);
  // The sanitizer checks its traversal stack for constrained tags such as td.
  const required = schema.ancestors?.[tagName]?.find(name => ancestors.includes(name));
  const branch = required ? element(required, {}, [candidate]) : candidate;
  const tree = sanitize({ type: 'root', children: [branch] } as Root, schema);
  const first = tree.type === 'root' ? tree.children[0] : undefined;
  const safe = required && first?.type === 'element' ? first.children[0] : first;
  return safe?.type === 'element' && safe.tagName === tagName ? safe : undefined;
}
