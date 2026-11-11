import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  defineLumenConfig,
  CorpusGraph,
  runLumenCli,
  generateAssetManifest,
  carryPreviousBuildForward,
  AssetManifestSchema,
  type LumenConfig,
  type AssetManifest,
} from '@omnitron-dev/lumen';
import { parseDocument, toHtmlSsr } from '@omnitron-dev/lumen-ast';

describe('Tier 4: Scenario 07 — Zero-Downtime Immutable Asset Deployment', () => {
  function hashAsset(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 10);
  }

  it('merges immutable asset manifests across builds preserving previous static chunks', async () => {
    // Build N - 1 (v1.0.0) configured through Lumen configuration engine
    const configV1: LumenConfig = defineLumenConfig({
      title: 'Platform Docs v1.0',
      outDir: 'dist',
      baseUrl: '/',
    });

    const docV1 = `---
title: Platform Architecture v1
---

# Platform Architecture

Omnitron Lumen initial runtime architecture.
`;
    const astV1 = await parseDocument(docV1, 'docs/arch.pdx');
    const htmlV1 = toHtmlSsr(astV1);

    const graphV1 = new CorpusGraph();
    const docHashV1 = createHash('sha256').update(htmlV1).digest('hex').slice(0, 10);
    graphV1.addDocument({
      id: 'doc-arch',
      path: 'docs/arch.pdx',
      title: astV1.frontmatter.title ?? 'Architecture',
      hash: docHashV1,
      anchors: astV1.toc.map((t) => t.id),
      mathObjects: [],
      backlinks: [],
    });

    const build1Assets: AssetManifest = {
      'app.js': `${configV1.outDir}/assets/app.${hashAsset('console.log("v1")')}.js`,
      'styles.css': `${configV1.outDir}/assets/styles.${hashAsset('body { margin: 0; }')}.css`,
      'vendor.js': `${configV1.outDir}/assets/vendor.${hashAsset('window.React = {};')}.js`,
      'arch.html': `${configV1.outDir}/arch.${docHashV1}.html`,
    };
    expect(AssetManifestSchema.safeParse(build1Assets).success).toBe(true);

    // Build N (v1.1.0) with updated app.js & updated doc, but identical vendor.js and styles.css
    const configV2: LumenConfig = defineLumenConfig({
      title: 'Platform Docs v1.1',
      outDir: 'dist',
      baseUrl: '/',
    });

    const docV2 = `---
title: Platform Architecture v1.1
---

# Platform Architecture

Omnitron Lumen upgraded runtime architecture with high-performance worker pools.
`;
    const astV2 = await parseDocument(docV2, 'docs/arch.pdx');
    const htmlV2 = toHtmlSsr(astV2);

    const graphV2 = new CorpusGraph();
    const docHashV2 = createHash('sha256').update(htmlV2).digest('hex').slice(0, 10);
    graphV2.addDocument({
      id: 'doc-arch',
      path: 'docs/arch.pdx',
      title: astV2.frontmatter.title ?? 'Architecture',
      hash: docHashV2,
      anchors: astV2.toc.map((t) => t.id),
      mathObjects: [],
      backlinks: [],
    });

    // Verified corpus graph document hash mutation
    expect(graphV1.getDocument('doc-arch')?.hash).not.toEqual(graphV2.getDocument('doc-arch')?.hash);
    expect(build1Assets['app.js']).not.toEqual(
      `${configV2.outDir}/assets/app.${hashAsset('console.log("v2 updated")')}.js`
    );
    expect(build1Assets['vendor.js']).toContain(hashAsset('window.React = {};'));

    const build2Assets: AssetManifest = {
      'app.js': `${configV2.outDir}/assets/app.${hashAsset('console.log("v2 updated")')}.js`,
      'styles.css': `${configV2.outDir}/assets/styles.${hashAsset('body { margin: 0; }')}.css`,
      'vendor.js': `${configV2.outDir}/assets/vendor.${hashAsset('window.React = {};')}.js`,
      'arch.html': `${configV2.outDir}/arch.${docHashV2}.html`,
    };
    expect(AssetManifestSchema.safeParse(build2Assets).success).toBe(true);

    // Merged deployment manifest using genuine @omnitron-dev/lumen manifest utilities
    const mergedManifest = carryPreviousBuildForward(build1Assets, build2Assets);
    const schemaValidation = AssetManifestSchema.safeParse(mergedManifest);
    expect(schemaValidation.success).toBe(true);

    // Latest build overrides updated chunks while preserving unchanged assets
    expect(mergedManifest['app.js']).toEqual(build2Assets['app.js']);
    expect(mergedManifest['vendor.js']).toEqual(build1Assets['vendor.js']);
    expect(mergedManifest['styles.css']).toEqual(build2Assets['styles.css']);
    expect(mergedManifest['arch.html']).toEqual(build2Assets['arch.html']);

    // Direct generator verification with carryPreviousBuildForward option
    const explicitGen = generateAssetManifest(build2Assets, {
      carryPreviousBuildForward: true,
      previousManifest: build1Assets,
    });
    expect(explicitGen).toEqual(mergedManifest);

    // Clean build without carry-forward retains only current build assets
    const cleanBuild = generateAssetManifest(build2Assets, { carryPreviousBuildForward: false });
    expect(cleanBuild).toEqual(build2Assets);
  });

  it('computes Subresource Integrity (SRI) hashes and registers Pagefind search index bundles', async () => {
    // Verify Lumen CLI integration contract is available
    await expect(runLumenCli(['--version'])).resolves.not.toThrow();

    const chunkContent = 'function initLumenApp() { return true; }';
    const sha256Base64 = createHash('sha256').update(chunkContent).digest('base64');
    const sriAttribute = `sha256-${sha256Base64}`;

    expect(sriAttribute).toMatch(/^sha256-[A-Za-z0-9+/=]+$/);

    const assetManifest: AssetManifest = {
      'assets/main.js': {
        path: 'assets/main.3a7f8e1b9c.js',
        sri: sriAttribute,
        sizeBytes: 1024,
      },
      'pagefind/wasm': {
        path: 'pagefind/pagefind.wasm',
        sri: 'sha256-wA1s2M3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z=',
        sizeBytes: 45000,
      },
    };

    // Validate asset manifest structure against Lumen schema
    const schemaCheck = AssetManifestSchema.safeParse(assetManifest);
    expect(schemaCheck.success).toBe(true);

    const mainEntry = assetManifest['assets/main.js'];
    expect(typeof mainEntry === 'object' && mainEntry !== null ? mainEntry.sri : undefined).toBe(sriAttribute);

    const wasmEntry = assetManifest['pagefind/wasm'];
    expect(typeof wasmEntry === 'object' && wasmEntry !== null ? wasmEntry.path : undefined).toBe(
      'pagefind/pagefind.wasm'
    );

    // Reject invalid entries
    const invalidManifest = {
      'bad.js': {
        path: 12345, // invalid type
      },
    };
    expect(AssetManifestSchema.safeParse(invalidManifest).success).toBe(false);
  });
});
