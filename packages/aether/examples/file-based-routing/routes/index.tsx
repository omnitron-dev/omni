/**
 * Home page - routes/index.tsx → /
 */

import { defineComponent } from '@omnitron-dev/aether';

export default defineComponent(() => {
  return () => (
    <div>
      <h1>Welcome to Aether</h1>
      <p>File-based routing example</p>
      <nav>
        <a href="/about">About</a>
        <a href="/blog">Blog</a>
        <a href="/users">Users</a>
        <a href="/login">Login</a>
      </nav>
    </div>
  );
});
