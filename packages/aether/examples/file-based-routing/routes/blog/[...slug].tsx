/**
 * Blog post page - routes/blog/[...slug].tsx → /blog/*slug
 * Catch-all route for nested blog paths
 */

import { defineComponent } from '@omnitron-dev/aether';
import { useParams } from '@omnitron-dev/aether/router';

export default defineComponent(() => {
  const params = useParams<{ slug: string[] }>();

  return () => (
    <div>
      <h1>Blog Post</h1>
      <p>Path: {params.slug.join(' / ')}</p>
      <div>
        <h2>Article Content</h2>
        <p>Content for: /{params.slug.join('/')}</p>
      </div>
    </div>
  );
});
