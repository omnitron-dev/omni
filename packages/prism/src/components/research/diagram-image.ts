import type { Config, DOMPurify } from 'dompurify';

const textTags = ['p', 'br', 'b', 'i', 'em', 'strong', 'code', 'del', 's', 'sub', 'sup'];

/** Sanitize document labels before Mermaid measures them. Layout wrappers are
 * added by the engine, never admitted from the document's label markup. */
export const diagramLabelPolicy: Config = {
  ALLOWED_TAGS: textTags,
  ALLOWED_ATTR: [],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
};

const htmlNamespace = 'http://www.w3.org/1999/xhtml';
const svgNamespace = 'http://www.w3.org/2000/svg';
const labelTags = new Set(['div', 'span', ...textTags]);
const labelClasses = new Set(['nodeLabel', 'edgeLabel', 'labelBkg', 'markdown-node-label', 'markdown-edge-label']);
const length = /^(?:\d+(?:\.\d+)?|\.\d+)(?:px|em|rem|%)?$/;
// Only the engine's text layout/formatting properties survive in an XHTML label.
// No resource-bearing CSS, positioning, custom properties or arbitrary functions.
const labelStyles: Record<string, RegExp> = {
  display: /^(?:block|inline|inline-block|table|table-cell)$/,
  'white-space': /^(?:normal|nowrap|pre|pre-wrap|pre-line|break-spaces)$/,
  'line-height': /^(?:normal|(?:\d+(?:\.\d+)?|\.\d+)(?:px|em|rem|%)?)$/,
  width: length,
  'min-width': length,
  'max-width': length,
  'text-align': /^(?:left|right|center|start|end)$/,
  'font-family': /^[-\p{L}\p{N}\s,'"]+$/u,
  'font-size': length,
  'font-weight': /^(?:normal|bold|bolder|lighter|[1-9]\d{0,2}|1000)$/,
  'font-style': /^(?:normal|italic|oblique)$/,
  'text-decoration': /^(?:none|underline|line-through)(?:\s+(?:underline|line-through))*$/,
  color: /^(?:#[\da-f]{3,8}|[a-z]+|(?:rgb|rgba|hsl|hsla)\([\d\s.,%/+-]+\))$/i,
};

function sanitizeLabel(foreignObject: Element): void {
  // Mermaid emits measured pixel dimensions, including zero for an empty label.
  if (foreignObject.namespaceURI !== svgNamespace || !['width', 'height'].every(name =>
    /^(?:\d+(?:\.\d+)?|\.\d+)(?:px)?$/.test(foreignObject.getAttribute(name) ?? '')
  )) {
    foreignObject.remove();
    return;
  }
  const geometry = foreignObject as SVGElement;
  const dimensions = ['width', 'height'].map(name => ({ name, value: geometry.style.getPropertyValue(name) }))
    .filter(({ value }) => /^(?:\d+(?:\.\d+)?|\.\d+)px$/.test(value));
  for (const attribute of foreignObject.getAttributeNames()) {
    if (!['width', 'height', 'x', 'y', 'transform'].includes(attribute)) foreignObject.removeAttribute(attribute);
  }
  for (const { name, value } of dimensions) geometry.style.setProperty(name, value);
  for (const element of foreignObject.querySelectorAll('*')) {
    if (!foreignObject.contains(element)) continue;
    if (element.namespaceURI !== htmlNamespace || !labelTags.has(element.localName)) {
      element.remove();
      continue;
    }
    const html = element as HTMLElement;
    const classes = (html.getAttribute('class') ?? '').split(/\s+/).filter(name => labelClasses.has(name));
    // CSSOM can enumerate a shorthand such as white-space as newer longhands.
    // Read our allowed properties by name so the measured shorthand survives.
    const styles = Object.keys(labelStyles)
      .map(name => ({ name, value: html.style.getPropertyValue(name), priority: html.style.getPropertyPriority(name) }))
      .filter(({ name, value }) => labelStyles[name]?.test(value));
    for (const attribute of html.getAttributeNames()) html.removeAttribute(attribute);
    if (classes.length) html.setAttribute('class', classes.join(' '));
    for (const { name, value, priority } of styles) html.style.setProperty(name, value, priority);
  }
}

/** The returned SVG must be consumed only by <img>, never injected into HTML.
 * SVG image isolation preserves Mermaid's layout CSS without granting it DOM
 * capabilities or allowing its styles to affect the surrounding document.
 * https://developer.mozilla.org/en-US/docs/Web/SVG/Guides/SVG_as_an_image
 */
export function diagramImage(source: string, purify: DOMPurify) {
  const fragment = purify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['style', 'foreignObject', ...labelTags],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
    FORBID_TAGS: ['image', 'a', 'script', 'animate', 'animateMotion', 'animateTransform', 'set'],
    FORBID_ATTR: ['href', 'xlink:href'],
    RETURN_DOM_FRAGMENT: true,
  });
  const svg = fragment.querySelector('svg');
  if (!svg || svg.namespaceURI !== svgNamespace || !svg.getAttribute('viewBox')) throw new Error('invalid_diagram_svg');
  for (const label of svg.querySelectorAll('foreignObject')) sanitizeLabel(label);
  const title = svg.querySelector('title')?.textContent?.trim();
  const labels = [...svg.querySelectorAll('text,foreignObject')].map((node) => node.textContent?.trim()).filter(Boolean);
  const description = title || labels.join(' · ') || 'Diagram';
  return {
    src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg)),
    description: description.slice(0, 2000),
  };
}
