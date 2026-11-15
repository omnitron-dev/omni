import React from 'react';
import { renderToString } from 'react-dom/server';
import createCache from '@emotion/cache';
import createEmotionServer from '@emotion/server/create-instance';
import { CacheProvider, ClassNames, Global } from '@emotion/react';
import { CardSkeleton } from '@omnitron-dev/prism/components/skeleton';
import { describe, expect, it } from 'vitest';
import { extractCriticalEmotionCss } from './emotion-extractor.js';

describe('critical Emotion style ownership', () => {
  it.each(['css', 'site'])('preserves %s Global/cache keys, order and nonce without duplicating rules', (key) => {
    const cache = createCache({ key, nonce: 'test-nonce' });
    const server = createEmotionServer(cache);
    const body = renderToString(
      React.createElement(
        CacheProvider,
        { value: cache },
        React.createElement(Global, { styles: { body: { margin: 0 } } }),
        React.createElement(ClassNames, {
          children: ({ css }) =>
            React.createElement(
              'div',
              { className: css({ color: 'red' }) },
              React.createElement('span', { className: css({ fontWeight: 600 }) }, 'Text')
            ),
        })
      )
    );
    const chunks = server.extractCriticalToChunks(body);
    const html = `<html><head></head><body>${server.constructStyleTagsFromChunks(chunks)}${body}</body></html>`;
    const result = extractCriticalEmotionCss(html, cache);
    const tokens = [...result.html.matchAll(/data-emotion="([^"]+)"/g)].map((match) => match[1]);
    expect(tokens).toEqual(chunks.styles.map((chunk) => `${chunk.key} ${chunk.ids.join(' ')}`));
    expect(result.css.match(/color:red/g)).toHaveLength(1);
    expect(result.html.match(/nonce="test-nonce"/g)).toHaveLength(2);
    expect(result.html.split('</head>')[1]).not.toContain('data-emotion');
    expect(result.html).toContain('<style data-lumen-theme>');
  });

  it('does not tell the browser an unprovided class has already been inserted', () => {
    const result = extractCriticalEmotionCss('<main class="css-not-rendered site-not-rendered">Content</main>');
    expect(result.ids).toEqual([]);
    expect(result.html).not.toContain('data-emotion');
  });

  it('preserves inline styles for separate caches and independently owned Globals', () => {
    const styles =
      '<style data-emotion="one-global g1" nonce="n1">body{color:red}</style>' +
      '<style data-emotion="one c1">.one-c1{display:block}</style>' +
      '<style data-emotion="two-global g2">body{color:blue}</style>' +
      '<style data-emotion="two c2">.two-c2{display:flex}</style>';
    const result = extractCriticalEmotionCss(`<head></head><body>${styles}</body>`);
    expect(result.styleTag.endsWith(styles)).toBe(true);
    expect(result.ids).toEqual(['g1', 'c1', 'g2', 'c2']);
    expect(extractCriticalEmotionCss(result.html).html).toBe(result.html);
  });

  it('propagates a broken cache instead of fabricating a successful CSS result', () => {
    const cache = createCache({ key: 'site' });
    Object.defineProperty(cache, 'inserted', {
      get() {
        throw new Error('Cache unavailable');
      },
    });
    expect(() => extractCriticalEmotionCss('<main>Document</main>', cache)).toThrow('Cache unavailable');
  });

  it('preserves shared serialized dependencies in native ClassNames output', () => {
    const cache = createCache({ key: 'site' });
    const body = renderToString(
      React.createElement(CacheProvider, { value: cache },
        React.createElement(ClassNames, { children: ({ css }) =>
          React.createElement('div', { className: `${css({ color: 'red' })} ${css({ fontWeight: 600 })}` }, 'First'),
        }),
        React.createElement(ClassNames, { children: ({ css }) =>
          React.createElement('div', { className: `${css({ fontWeight: 600 })} ${css({ color: 'blue' })}` }, 'Second'),
        }),
      )
    );
    const tags = [...body.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/g)].map(match => match[0]);
    expect(tags).toHaveLength(2);
    const result = extractCriticalEmotionCss(`<head></head><body>${body}</body>`);
    expect(result.styleTag.endsWith(tags.join(''))).toBe(true);
    expect(result.css.match(/font-weight:600/g)).toHaveLength(1);
    expect(result.css).toContain('color:red');
    expect(result.css).toContain('color:blue');
  });

  it('preserves shared keyframes emitted by the real Prism card skeleton', () => {
    const body = renderToString(React.createElement(CacheProvider, { value: createCache({ key: 'prism-ltr' }) },
      React.createElement(CardSkeleton, { hasAvatar: false, lines: 2 }),
    ));
    const tags = [...body.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/g)].map(match => match[0]);
    expect(tags.length).toBeGreaterThan(2);
    expect(tags.join('')).toContain('@keyframes');
    const result = extractCriticalEmotionCss(`<head></head><body>${body}</body>`);
    expect(result.styleTag.endsWith(tags.join(''))).toBe(true);
    expect(extractCriticalEmotionCss(result.html).html).toBe(result.html);
  });

  it('retains repeated Global instances in their cascade order', () => {
    const body = renderToString(React.createElement(CacheProvider, { value: createCache({ key: 'site' }) },
      ...['red', 'blue', 'red'].map((color, key) => React.createElement(Global, { key, styles: { body: { color } } })),
    ));
    const tags = [...body.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/g)].map(match => match[0]);
    expect(tags).toHaveLength(3);
    const result = extractCriticalEmotionCss(`<head></head><body>${body}</body>`);
    expect(result.styleTag.endsWith(tags.join(''))).toBe(true);
    expect(result.css.match(/body\{color:[^}]+\}/g)).toEqual(['body{color:red;}', 'body{color:blue;}', 'body{color:red;}']);
  });

  it('rejects inline metadata without an Emotion cache key', () => {
    expect(() => extractCriticalEmotionCss('<style data-emotion=" ">body{color:red}</style>'))
      .toThrow('Emotion style is missing its cache key');
  });
});
