// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import purify from 'dompurify';
import { diagramImage, diagramLabelPolicy } from './diagram-image.js';

describe('isolated SVG diagrams', () => {
  it('preserves the layout styles that place labels inside nodes', () => {
    const image = diagramImage(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><style>.label text { text-anchor: middle; }</style><g class="label"><text x="100" style="font-size:16px">Evidence</text></g></svg>',
      purify
    );
    const svg = decodeURIComponent(image.src.split(',').slice(1).join(','));
    expect(image.src).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(svg).toContain('text-anchor: middle');
    expect(svg).toContain('font-size:16px');
    expect(image.description).toBe('Evidence');
  });
  it('removes active elements and links before image isolation', () => {
    const image = diagramImage(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" onload="alert(1)"><script>alert(1)</script><foreignObject><div>active</div></foreignObject><image href="https://example.test/tracker"/><set attributeName="onload" to="alert(1)"/><title>Source to outcome</title><text onclick="alert(1)">Label</text></svg>',
      purify
    );
    const svg = decodeURIComponent(image.src.split(',').slice(1).join(','));
    expect(svg).not.toMatch(/script|foreignObject|<image|<set|onload|onclick|href=/);
    expect(image.description).toBe('Source to outcome');
  });
  it('rejects a payload without a scalable SVG viewport', () => {
    expect(() => diagramImage('<p>Not a diagram</p>', purify)).toThrow('invalid_diagram_svg');
    expect(() => diagramImage('<svg/>', purify)).toThrow('invalid_diagram_svg');
  });
  it('preserves measured XHTML text and formatting without decoding its entities into markup', () => {
    const image = diagramImage(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 80"><foreignObject width="200.5" height="48" style="width:202px;height:48px" transform="translate(10 10)"><div xmlns="http://www.w3.org/1999/xhtml" style="display:table-cell;white-space:nowrap;line-height:1.5;max-width:200px;text-align:center"><span class="nodeLabel"><p>A &quot;quoted&quot; <strong>contract</strong><br/>x &lt; y &amp; y &gt; 0</p></span></div></foreignObject></svg>', purify
    );
    const svg = new DOMParser().parseFromString(decodeURIComponent(image.src.split(',').slice(1).join(',')), 'image/svg+xml');
    expect(svg.querySelector('parsererror')).toBeNull();
    const label = svg.querySelector('foreignObject')!;
    expect(label.getAttribute('width')).toBe('200.5');
    expect(label.getAttribute('height')).toBe('48');
    expect(label.getAttribute('transform')).toBe('translate(10 10)');
    expect(label.getAttribute('style')).toBe('width: 202px; height: 48px;');
    expect(label.querySelector('div')?.getAttribute('style')).toContain('display: table-cell');
    expect(label.querySelector('div')?.getAttribute('style')).toContain('white-space: nowrap');
    expect(label.querySelector('div')?.getAttribute('style')).toContain('max-width: 200px');
    expect(label.querySelector('span')?.getAttribute('class')).toBe('nodeLabel');
    expect(label.querySelector('strong')?.textContent).toBe('contract');
    expect([...label.querySelectorAll('*')].every(node => node.namespaceURI === 'http://www.w3.org/1999/xhtml')).toBe(true);
    expect(image.description).toContain('A "quoted" contract');
    expect(image.description).toContain('x < y & y > 0');
  });
  it('admits no label resources, actions, foreign namespaces or arbitrary layout CSS', () => {
    const image = diagramImage(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 80"><foreignObject width="200" height="40" style="background:url(https://example.test/fo)"><div xmlns="http://www.w3.org/1999/xhtml" id="clobber" data-secret="private" onclick="alert(1)" style="display:table-cell;position:fixed;inset:0;background:url(https://example.test/css);--resource:url(https://example.test/custom)"><span class="nodeLabel evil" style="color:rgb(10,20,30);font-size:16px;font-family:var(--resource)">Safe &lt;img src=/canary&gt;</span><img src="https://example.test/img"/><iframe src="https://example.test/frame"/><a href="javascript:alert(1)">Link</a><style>body{display:none}</style><svg xmlns="http://www.w3.org/2000/svg"><text>Wrong namespace</text></svg></div></foreignObject></svg>', purify
    );
    const output = decodeURIComponent(image.src.split(',').slice(1).join(','));
    const svg = new DOMParser().parseFromString(output, 'image/svg+xml');
    expect(svg.querySelector('parsererror')).toBeNull();
    expect(svg.querySelector('foreignObject')?.textContent).toContain('Safe <img src=/canary>');
    expect(svg.querySelector('foreignObject svg,foreignObject style,img,iframe,a')).toBeNull();
    expect(output).not.toMatch(/https:|onclick|clobber|data-secret|position:|inset:|background:|--resource|var\(|class="[^"]*evil/);
    expect(svg.querySelector('div')?.getAttribute('style')).toBe('display: table-cell;');
    expect(svg.querySelector('span')?.getAttribute('style')).toContain('font-size: 16px');
  });
  it('uses a text-only document policy before the engine adds measured wrappers', () => {
    const clean = purify.sanitize('<span class="nodeLabel" style="font-size:1000px" data-value="x"><strong>Readable</strong><img src="/canary"/><script>alert(1)</script></span>', diagramLabelPolicy);
    expect(clean).toBe('<strong>Readable</strong>');
  });
});
