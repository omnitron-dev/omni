import { lazy } from 'react';

// Both CLI-compiled SSR and the browser use this exact project registry.
const modules = import.meta.glob(['./ssr-preview.jsx', './ssr-browser-only.jsx']);
export const ssrIslands = {
  SharedPreview: lazy(() => modules['./ssr-preview.jsx']()),
  BrowserOnly: lazy(() => modules['./ssr-browser-only.jsx']()),
};
