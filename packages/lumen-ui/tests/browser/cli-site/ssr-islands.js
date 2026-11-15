import { lazy } from 'react';

// Both CLI-compiled SSR and the browser use this exact project registry.
const modules = import.meta.glob('./ssr-preview.jsx');
export const ssrIslands = {
  SharedPreview: lazy(() => modules['./ssr-preview.jsx']()),
};
