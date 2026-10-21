import type { DOMPurify } from 'dompurify';

/** The returned SVG must be consumed only by <img>, never injected into HTML.
 * SVG image isolation preserves Mermaid's layout CSS without granting it DOM
 * capabilities or allowing its styles to affect the surrounding document.
 * https://developer.mozilla.org/en-US/docs/Web/SVG/Guides/SVG_as_an_image
 */
export function diagramImage(source: string, purify: DOMPurify) {
  const fragment = purify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['style'],
    FORBID_TAGS: ['foreignObject', 'image', 'a', 'script', 'animate', 'animateMotion', 'animateTransform', 'set'],
    FORBID_ATTR: ['href', 'xlink:href'],
    RETURN_DOM_FRAGMENT: true,
  });
  const svg = fragment.querySelector('svg');
  if (!svg || !svg.getAttribute('viewBox')) throw new Error('invalid_diagram_svg');
  const title = svg.querySelector('title')?.textContent?.trim();
  const labels = [...svg.querySelectorAll('text')].map((node) => node.textContent?.trim()).filter(Boolean);
  const description = title || labels.join(' · ') || 'Diagram';
  return {
    src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg)),
    description: description.slice(0, 2000),
  };
}
