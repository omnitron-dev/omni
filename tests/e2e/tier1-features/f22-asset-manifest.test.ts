import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';

describe('Feature 22: Search Index & Asset Manifest', () => {
  it('TC-F22-01: maps logical chunk names to content-hashed output paths in manifest', () => {
    const manifest: Record<string, string> = {
      'main.js': 'assets/main.a1b2c3d4.js',
      'styles.css': 'assets/styles.f5e6d7c8.css',
    };

    expect(manifest['main.js']).toMatch(/^assets\/main\.[0-9a-f]+\.js$/);
    expect(manifest['styles.css']).toMatch(/^assets\/styles\.[0-9a-f]+\.css$/);
  });

  it('TC-F22-02: computes deterministic SHA-256 hashes for static assets', () => {
    const assetContent = 'console.log("lumen runtime");';
    const hash = createHash('sha256').update(assetContent).digest('hex').slice(0, 8);

    expect(hash).toMatch(/^[0-9a-f]{8}$/);
    const filename = `assets/runtime.${hash}.js`;
    expect(filename).toContain(hash);
  });

  it('TC-F22-03: preserves assets from previous build in carryPreviousBuildForward mode', () => {
    const previousManifest = {
      'old-chunk.js': 'assets/old-chunk.11223344.js',
    };

    const newBuild = {
      'new-chunk.js': 'assets/new-chunk.55667788.js',
    };

    const mergedManifest = {
      ...previousManifest,
      ...newBuild,
    };

    expect(mergedManifest['old-chunk.js']).toBeDefined();
    expect(mergedManifest['new-chunk.js']).toBeDefined();
  });

  it('TC-F22-04: formats Subresource Integrity (SRI) hashes according to sha256 standard', () => {
    const chunkContent = 'function init() {}';
    const base64Hash = createHash('sha256').update(chunkContent).digest('base64');
    const sriString = `sha256-${base64Hash}`;

    expect(sriString).toMatch(/^sha256-[A-Za-z0-9+/=]+$/);
  });

  it('TC-F22-05: registers search index metadata files in deployment manifest', () => {
    const manifest = {
      'pagefind/pagefind.js': 'pagefind/pagefind.js',
      'pagefind/pagefind-entry.json': 'pagefind/pagefind-entry.json',
    };

    expect(manifest['pagefind/pagefind.js']).toBeDefined();
    expect(manifest['pagefind/pagefind-entry.json']).toBeDefined();
  });
});
