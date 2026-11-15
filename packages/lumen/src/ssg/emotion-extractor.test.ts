import React from 'react';
import { renderToString } from 'react-dom/server';
import createCache from '@emotion/cache';
import createEmotionServer from '@emotion/server/create-instance';
import { CacheProvider, ClassNames, Global } from '@emotion/react';
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

  it('rejects partially overlapping chunks that cannot be split without changing their rules', () => {
    expect(() =>
      extractCriticalEmotionCss(
        '<style data-emotion="site a b">.a{color:red}.b{color:blue}</style>' +
          '<style data-emotion="site b c">.b{color:blue}.c{color:black}</style>'
      )
    ).toThrow('Overlapping Emotion chunks');
  });
});
