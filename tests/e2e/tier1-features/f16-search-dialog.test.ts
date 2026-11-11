import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LumenSearchDialog, PortalIslandHost } from '@omnitron-dev/lumen-ui';

describe('Feature 16: Hybrid Search Dialog', () => {
  it('TC-F16-01: renders dialog when open is set to true', () => {
    const html = renderToStaticMarkup(React.createElement(LumenSearchDialog, { open: true }));

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('class="lumen-search-dialog"');
  });

  it('TC-F16-02: returns null when open is false', () => {
    const html = renderToStaticMarkup(React.createElement(LumenSearchDialog, { open: false }));

    expect(html).toBe('');
  });

  it('TC-F16-03: contains search input with placeholder text', () => {
    const html = renderToStaticMarkup(React.createElement(LumenSearchDialog, { open: true }));

    expect(html).toContain('type="search"');
    expect(html).toContain('placeholder="Search documentation..."');
  });

  it('TC-F16-04: includes close button with onClose handler', () => {
    const html = renderToStaticMarkup(React.createElement(LumenSearchDialog, { open: true, onClose: () => {} }));

    expect(html).toContain('<button');
    expect(html).toContain('Close</button>');
  });

  it('TC-F16-05: encapsulates search dialog in PortalIslandHost with interaction trigger', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        PortalIslandHost,
        {
          islandId: 'search-modal-island',
          hydrate: 'interaction',
        },
        React.createElement(LumenSearchDialog, { open: true })
      )
    );

    expect(html).toContain('data-lumen-island="search-modal-island"');
    expect(html).toContain('data-hydrate="interaction"');
    expect(html).toContain('role="dialog"');
  });
});
