// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import purify from 'dompurify';
import { diagramImage } from './diagram-image.js';

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
});
