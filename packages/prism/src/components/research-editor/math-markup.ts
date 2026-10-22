import DOMPurify from 'dompurify';

// Layout properties required by typeset atoms; none can fetch an external resource.
const layoutProperties = new Set([
  'color',
  'background-color',
  'opacity',
  'height',
  'width',
  'min-width',
  'max-width',
  'min-height',
  'max-height',
  'top',
  'bottom',
  'left',
  'right',
  'vertical-align',
  'margin',
  'margin-top',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'padding',
  'padding-top',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'border',
  'border-top',
  'border-bottom',
  'border-left',
  'border-right',
  'border-color',
  'border-width',
  'border-style',
  'border-radius',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'display',
  'visibility',
  'text-align',
  'white-space',
  'transform',
  'transform-origin',
]);
/** Preserve MathLive's editable sink and local SVG icons, without DOM capabilities
 * or CSS/resource injection from an imported formula's presentation commands. */
export function sanitizeMathMarkup(html: string): string {
  const fragment = DOMPurify.sanitize(html, {
    ADD_ATTR: ['contenteditable'],
    ADD_TAGS: ['use'],
    FORBID_TAGS: ['style', 'link', 'iframe', 'object', 'embed', 'img', 'image', 'foreignObject'],
    RETURN_DOM_FRAGMENT: true,
  });
  for (const element of fragment.querySelectorAll('*')) {
    for (const attribute of Array.from(element.attributes)) {
      if (
        ['href', 'xlink:href', 'src', 'action', 'formaction', 'poster'].includes(attribute.name) &&
        !(element.localName === 'use' && /^#[\w-]+$/.test(attribute.value))
      )
        element.removeAttribute(attribute.name);
    }
  }
  for (const element of fragment.querySelectorAll('[style]')) {
    const parsed = document.createElement('span').style;
    parsed.cssText = element.getAttribute('style') ?? '';
    const safe = document.createElement('span').style;
    for (const name of Array.from(parsed)) {
      if (layoutProperties.has(name)) safe.setProperty(name, parsed.getPropertyValue(name));
    }
    if (safe.cssText) element.setAttribute('style', safe.cssText);
    else element.removeAttribute('style');
  }
  for (const element of fragment.querySelectorAll('[fill], [stroke]')) {
    for (const name of ['fill', 'stroke']) {
      const value = element.getAttribute(name);
      if (value && /url|\\/i.test(value)) element.removeAttribute(name);
    }
  }
  const wrapper = document.createElement('div');
  wrapper.append(fragment);
  return wrapper.innerHTML;
}
