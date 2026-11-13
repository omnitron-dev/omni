import { createElement, useState } from 'react';
import { readFileSync } from 'node:fs';
import { ComponentExample } from '@omnitron-dev/lumen-ui/blocks';
import { DocPagination } from '@omnitron-dev/lumen-ui/layout';
import { PortalIslandHost } from '@omnitron-dev/lumen-ui/runtime';
import CounterExample from './counter-example.js';

const counterSource = readFileSync(new URL('./counter-example.js', import.meta.url), 'utf8');

function Layout({ children }) {
  const [state] = useState('CUSTOM_LAYOUT_STATE');
  return createElement('section', { 'data-ssr-layout': state },
    createElement('h1', null, 'CLI browser boundary'), children,
    createElement(PortalIslandHost, { islandId: 'counter-example', component: 'CounterDemo', hydrate: 'load' },
      createElement(ComponentExample, { title: 'Counter example', code: counterSource, language: 'js', resettable: true },
        createElement(CounterExample))),
    createElement(DocPagination, { labels: { previous: 'Anterior', next: 'Siguiente', navigation: 'Documentos' },
      prev: { href: '#native-cli-document', label: 'Inicio' }, next: { href: '#native-cli-document', label: 'Detalles' } }),
    ...['both', 'previous', 'next'].map(kind => createElement('section', {
      key: kind, 'data-pagination': kind, style: { margin: '20px', maxWidth: 900 },
    }, createElement(DocPagination, {
      prev: kind === 'next' ? undefined : { href: '#native-cli-document', label: 'Previous documentation page' },
      next: kind === 'previous' ? undefined : { href: '#native-cli-document', label: 'Next documentation page' },
    }))));
}

export default {
  title: 'CLI browser boundary',
  clientEntry: 'client.jsx',
  theme: { layout: Layout },
};
