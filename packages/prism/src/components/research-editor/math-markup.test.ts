// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { sanitizeMathMarkup } from './math-markup.js';
it('preserves editable input and local SVG icons while rejecting executable and external markup', () => {
  const host = document.createElement('div');
  host.innerHTML = sanitizeMathMarkup(
    `<span contenteditable=true role=textbox onclick="alert(1)"></span><svg><use href="#svg-backspace"/><use href="https://example.test/remote.svg#icon"/></svg><script>alert(1)</script><img src="https://example.test/tracker"><a href="javascript:alert(1)">link</a>`
  );
  expect(host.querySelector('[role=textbox]')?.getAttribute('contenteditable')).toBe('true');
  expect(host.querySelector('use')?.getAttribute('href')).toBe('#svg-backspace');
  expect(host.querySelector('script')).toBeNull();
  expect(host.querySelector('[onclick], [src], a[href], use[href^="https"]')).toBeNull();
});

it('retains mathematical layout while refusing source-controlled stylesheets and resource-loading CSS', () => {
  const host = document.createElement('div');
  host.innerHTML = sanitizeMathMarkup(
    '<style>body{display:none}</style><span style="height:1em;color:red;background-image:url(https://example.test/tracker);position:fixed">x</span><svg><path fill="url(https://example.test/a)" /></svg>'
  );
  const span = host.querySelector('span')!;
  expect(span.style.height).toBe('1em');
  expect(span.style.color).toBe('red');
  expect(span.style.backgroundImage).toBe('');
  expect(span.style.position).toBe('');
  expect(host.querySelector('style')).toBeNull();
  expect(host.querySelector('[fill]')).toBeNull();
});
