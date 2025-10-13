/**
 * 404 Not Found page - routes/_404.tsx
 * Shown when no route matches
 */

import { defineComponent } from '@omnitron-dev/aether';

export default defineComponent(() => {
  return () => (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h1 style={{ fontSize: '6rem', color: '#ccc' }}>404</h1>
      <h2>Page Not Found</h2>
      <p>The page you're looking for doesn't exist.</p>
      <a href="/">Go home</a>
    </div>
  );
});
