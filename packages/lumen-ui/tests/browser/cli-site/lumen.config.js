import { createElement, useState } from 'react';
import { DocPagination } from '@omnitron-dev/lumen-ui/layout';

function Layout({ children }) {
  const [state] = useState('CUSTOM_LAYOUT_STATE');
  return createElement('section', { 'data-ssr-layout': state },
    createElement('h1', null, 'CLI browser boundary'), children,
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
