import { createElement, useState } from 'react';

function Layout({ children }) {
  const [state] = useState('CUSTOM_LAYOUT_STATE');
  return createElement('section', { 'data-ssr-layout': state },
    createElement('h1', null, 'CLI browser boundary'), children);
}

export default {
  title: 'CLI browser boundary',
  clientEntry: 'client.jsx',
  theme: { layout: Layout },
};
