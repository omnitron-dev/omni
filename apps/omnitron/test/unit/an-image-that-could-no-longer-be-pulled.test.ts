/**
 * The MinIO image was gone from the registry, and only a warm cache hid it.
 *
 * The preset named `minio/minio` — no tag, no registry. Docker Hub answers
 * that with `pull access denied for minio/minio, repository does not exist
 * or may require 'docker login'`, for `:latest` and for an exact RELEASE tag
 * alike. Every machine that pulled it before the change still runs it from
 * its local cache, which is why nothing noticed: the development host was
 * fine and a NEW node could not get it at all.
 *
 * Measured provisioning the test server: of postgres, redis and minio, two
 * came up and MinIO failed at `docker run`.
 *
 * The image was also named a second time, in the prefetch that runs when a
 * stack is created — and the copies had drifted, because only one of them
 * is what the resolver uses.
 */

import { describe, it, expect } from 'vitest';

import { createDefaultRegistry } from '../../src/infrastructure/presets/index.js';

describe('the image a preset names', () => {
  it('is pinned, and from a registry that serves it', () => {
    const minio = createDefaultRegistry().get('minio');

    // quay.io, because Docker Hub no longer carries it.
    expect(minio?.defaultImage).toMatch(/^quay\.io\/minio\/minio:/);
    // Pinned, because an unpinned tag is how this arrived: a config that
    // names no version cannot be reasoned about after the registry changes
    // under it, and "it worked yesterday" stops being evidence.
    expect(minio?.defaultImage).toMatch(/:RELEASE\.\d{4}-\d{2}-\d{2}/);
  });

  it('is pinned for the other two as well', () => {
    const registry = createDefaultRegistry();

    for (const name of ['postgres', 'redis']) {
      const image = registry.get(name)?.defaultImage ?? '';
      expect(image).toMatch(/:/);
      // `:latest` is the tag that cannot be reasoned about.
      expect(image).not.toMatch(/:latest$/);
    }
  });
});
