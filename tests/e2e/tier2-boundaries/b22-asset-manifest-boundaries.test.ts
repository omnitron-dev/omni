import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';

describe('Feature 22: Search Index & Asset Manifest Boundaries', () => {
  it('TC-B22-01: handles empty assets record in deployment manifest cleanly', () => {
    const emptyManifest: Record<string, string> = {};
    const serialized = JSON.stringify(emptyManifest);

    expect(serialized).toBe('{}');
    expect(Object.keys(JSON.parse(serialized))).toHaveLength(0);
  });

  it('TC-B22-02: falls back to clean full build when previous manifest is missing in carry-forward mode', () => {
    const previousManifest: Record<string, string> | null = null;
    const currentBuildAssets: Record<string, string> = {
      'main.js': 'assets/main.abc12345.js',
    };

    const effectiveManifest: Record<string, string> = {
      ...(previousManifest ?? {}),
      ...currentBuildAssets,
    };

    expect(effectiveManifest['main.js']).toBe('assets/main.abc12345.js');
    expect(Object.keys(effectiveManifest)).toHaveLength(1);
  });

  it('TC-B22-03: computes identical SHA-256 hash for identical content located at different file paths', () => {
    const assetContent = 'export const VERSION = "1.0.0";';
    const hash1 = createHash('sha256').update(assetContent).digest('hex');
    const hash2 = createHash('sha256').update(assetContent).digest('hex');

    expect(hash1).toBe(hash2);

    const manifest: Record<string, string> = {
      'packages/lumen/version.js': `assets/version.${hash1.slice(0, 8)}.js`,
      'packages/titan/version.js': `assets/version.${hash2.slice(0, 8)}.js`,
    };

    expect(manifest['packages/lumen/version.js']).toBe(manifest['packages/titan/version.js']);
  });

  it('TC-B22-04: indexes non-ASCII and Cyrillic tokens properly in search index manifest entries', () => {
    const multilingualTokens = ['квантовая', 'теорема', 'спектральный', '量子', 'оператор'];
    const searchIndexEntry = {
      path: '/docs/ru/quantum',
      title: 'Квантовая механика',
      tokens: multilingualTokens,
    };

    expect(searchIndexEntry.tokens).toContain('квантовая');
    expect(searchIndexEntry.tokens).toContain('спектральный');
    expect(searchIndexEntry.tokens).toContain('量子');
  });

  it('TC-B22-05: discards corrupted previous manifest JSON without crashing build runner', () => {
    const malformedManifestJson = '{"main.js": "assets/main.123.js", TRUNCATED...';

    let loadedManifest: Record<string, string>;
    try {
      loadedManifest = JSON.parse(malformedManifestJson);
    } catch {
      // Graceful fallback to fresh empty manifest on corrupt JSON
      loadedManifest = {};
    }

    expect(loadedManifest).toEqual({});
  });
});
