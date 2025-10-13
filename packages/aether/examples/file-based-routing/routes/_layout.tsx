/**
 * Root layout - routes/_layout.tsx
 * Wraps all pages
 */

import { defineComponent } from '@omnitron-dev/aether';
import { Outlet } from '@omnitron-dev/aether/router';

export default defineComponent(() => {
  return () => (
    <html>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Aether App</title>
      </head>
      <body>
        <header>
          <nav>
            <a href="/">Home</a>
            <a href="/about">About</a>
            <a href="/blog">Blog</a>
          </nav>
        </header>

        <main>
          <Outlet />
        </main>

        <footer>
          <p>&copy; 2025 Aether App</p>
        </footer>
      </body>
    </html>
  );
});
