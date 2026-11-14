import { createElement, useState } from 'react';
import { readFileSync } from 'node:fs';
import { ComponentExample } from '@omnitron-dev/lumen-ui/blocks';
import { DocPagination } from '@omnitron-dev/lumen-ui/layout';
import { PortalIslandHost } from '@omnitron-dev/lumen-ui/runtime';
import { PrismProvider } from '@omnitron-dev/prism/core';
import CounterExample from './counter-example.js';
import StyleBoundary from './style-boundary.js';

const counterSource = readFileSync(new URL('./counter-example.js', import.meta.url), 'utf8');

function Layout({ children, document }) {
  const [state] = useState('CUSTOM_LAYOUT_STATE');
  if (document.routePath === '/docs/style-boundary') {
    return createElement(PrismProvider, { mode: 'light' },
      createElement('section', { 'data-style-reference': true }, createElement(StyleBoundary)),
      createElement('article', { className: 'lumen-doc', 'data-style-prose': true },
        createElement('h4', { 'data-prose-heading': true }, 'Ordinary prose heading'),
        createElement('a', { href: '#style-boundary-document', 'data-prose-link': true }, 'Ordinary prose link'),
        createElement('div', { 'data-example': 'style-boundary' }, createElement(StyleBoundary))),
      children);
  }
  return createElement(PrismProvider, { mode: 'light', disableCssBaseline: true },
    createElement('section', { 'data-ssr-layout': state },
    createElement('h1', null, 'CLI browser boundary'), children,
    createElement(PortalIslandHost, { islandId: 'counter-example', component: 'CounterDemo', hydrate: 'load' },
      createElement(ComponentExample, { title: 'Counter example', code: counterSource, language: 'js', resettable: true },
        createElement(CounterExample))),
    createElement(PortalIslandHost, { islandId: 'failure-preview', component: 'FailurePreview', hydrate: 'interaction' },
      createElement('span', null, 'Recorded preview')),
    createElement(DocPagination, { labels: { previous: 'Anterior', next: 'Siguiente', navigation: 'Documentos' },
      prev: { href: '#native-cli-document', label: 'Inicio' }, next: { href: '#native-cli-document', label: 'Detalles' } }),
    ...['both', 'previous', 'next'].map(kind => createElement('section', {
      key: kind, 'data-pagination': kind, style: { margin: '20px', maxWidth: 900 },
    }, createElement(DocPagination, {
      prev: kind === 'next' ? undefined : { href: '#native-cli-document', label: 'Previous documentation page' },
      next: kind === 'previous' ? undefined : { href: '#native-cli-document', label: 'Next documentation page' },
    })))));
}

export default {
  title: 'CLI browser boundary',
  clientEntry: 'client.jsx',
  examples: { SourceExample: { sources: { source: 'source-example.jsx' }, language: 'jsx' } },
  theme: { layout: Layout },
};
