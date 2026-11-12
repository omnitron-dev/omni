import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import {
  defineLumenConfig,
  CorpusGraph,
  buildStaticSite,
  runLumenCli,
  generateAssetManifest,
  carryPreviousBuildForward,
  AssetManifestSchema,
  tokenizeMultilingual,
  generateSearchIndex,
  type LumenConfig,
  type AssetManifest,
} from '@omnitron-dev/lumen';
import { parseDocument } from '@omnitron-dev/lumen-ast';

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const BIN_PATH = resolve(REPO_ROOT, 'packages/lumen/bin/lumen.js');

describe('Empirical Stress Harness: Milestone 4 (@omnitron-dev/lumen)', () => {
  describe('Suite 1: SSG Build Concurrency (100+ documents) & Isolation', () => {
    it('renders 120 documents concurrently via Promise.all with zero cross-doc state leaks and isolated Emotion CSS caches', async () => {
      const docCount = 120;
      const config: LumenConfig = defineLumenConfig({
        title: 'Concurrent Stress Documentation',
        baseUrl: '/',
        theme: { defaultMode: 'dark' },
      });

      const corpus = new CorpusGraph();

      for (let i = 0; i < docCount; i++) {
        const docContent = `---
title: Doc ${i} Concurrent Stress Title
description: Description for doc ${i}
locale: en
---

# Heading Level 1 for Doc ${i}

<div data-lumen-island="island-${i}" class="css-doc-${i}-style lumen-portal-island">
Content uniquely belonging to document ${i}.
</div>
`;
        const ast = await parseDocument(docContent, `docs/doc-${i}.pdx`);

        corpus.addDocument({
          id: `doc-${i}`,
          path: `docs/doc-${i}.pdx`,
          title: `Doc ${i} Concurrent Stress Title`,
          routePath: `/docs/doc-${i}`,
          locale: 'en',
          anchors: [`heading-${i}`, `thm-doc-${i}`],
          mathObjects: [
            {
              id: `thm-doc-${i}`,
              title: `Theorem ${i}`,
              envType: 'theorem',
              docId: `doc-${i}`,
              dependencies: [],
            },
          ],
          backlinks: [],
          ast,
        });
      }

      expect(corpus.getAllDocuments()).toHaveLength(docCount);

      const startTime = Date.now();
      const result = await buildStaticSite(corpus, config);
      const durationMs = Date.now() - startTime;

      // 1. Build result integrity
      expect(result.pagesCount).toBe(docCount);
      expect(result.pages.size).toBe(docCount);
      expect(durationMs).toBeLessThan(10000); // 120 docs rendered well within 10s

      // 2. Cross-document isolation and zero style bleed
      for (let i = 0; i < docCount; i++) {
        const route = `/docs/doc-${i}`;
        const html = result.pages.get(route);
        expect(html).toBeDefined();

        // Own content must be present
        expect(html).toContain(`Doc ${i} Concurrent Stress Title`);
        expect(html).toContain(`Content uniquely belonging to document ${i}`);

        // Emotion CSS extraction: must contain own CSS ID
        expect(html).toContain(`data-emotion="css`);
        expect(html).toContain(`doc-${i}-style`);

        // Check against bleed from next neighbor document (i + 1)
        if (i < docCount - 1) {
          const neighborIdx = i + 1;
          expect(html).not.toContain(`Content uniquely belonging to document ${neighborIdx}.`);
          // Verify neighbor's Emotion CSS ID is NOT leaked into document i's style tag
          const styleTagMatch = html!.match(/<style data-emotion="css ([^"]+)">/);
          expect(styleTagMatch).not.toBeNull();
          const emotionIds = (styleTagMatch![1] ?? '').split(' ');
          expect(emotionIds).toContain(`doc-${i}-style`);
          expect(emotionIds).not.toContain(`doc-${neighborIdx}-style`);
        }
      }

      // 3. Manifest contains all routes with valid hashes and SRI
      for (let i = 0; i < docCount; i++) {
        const route = `/docs/doc-${i}`;
        const entry = result.manifest[`routes${route}.html`];
        const html = result.pages.get(route)!;
        expect(entry).toEqual({
          path: `docs/doc-${i}.html`,
          hash: createHash('sha256').update(html).digest('hex').slice(0, 8),
          sri: `sha256-${createHash('sha256').update(html).digest('base64')}`,
          sizeBytes: Buffer.byteLength(html),
        });
      }
    });
  });

  describe('Suite 2: CLI Edge Cases, Execution Modes & Double Execution', () => {
    it('executes programmatic runLumenCli with empty arguments cleanly', async () => {
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(' '));
      try {
        await runLumenCli([]);
        expect(logs.some((l) => l.includes('Lumen CLI v'))).toBe(true);
        expect(logs.some((l) => l.includes('Commands:'))).toBe(true);
      } finally {
        console.log = origLog;
      }
    });

    it('rejects programmatic runLumenCli with unknown subcommand with nonzero exitCode', async () => {
      const errors: string[] = [];
      const origError = console.error;
      const prevExitCode = process.exitCode;
      console.error = (...args: unknown[]) => errors.push(args.join(' '));
      try {
        await runLumenCli(['unrecognized-subcommand-404']);
        expect(errors.some((l) => l.includes('Unknown command: unrecognized-subcommand-404'))).toBe(true);
        expect(process.exitCode).toBe(1);
      } finally {
        process.exitCode = prevExitCode ?? 0;
        console.error = origError;
      }
    });

    it('challenges binary execution bin/lumen.js: checks for single invocation vs double invocation', () => {
      // Run --version directly via node on bin/lumen.js
      const procVersion = spawnSync(process.execPath, [BIN_PATH, '--version'], {
        encoding: 'utf-8',
        cwd: REPO_ROOT,
      });

      expect(procVersion.status).toBe(0);
      const versionLines = procVersion.stdout.trim().split(/\r?\n/).filter(Boolean);

      // CHALLENGE: Does bin/lumen.js print version once or twice?
      // If it prints twice, this empirically reproduces the double-invocation bug!
      const versionOccurrences = versionLines.filter((l) => /^\d+\.\d+\.\d+$/.test(l));
      expect(
        versionOccurrences.length,
        `Expected exactly 1 version output, but got ${versionOccurrences.length}: ${JSON.stringify(versionLines)}`
      ).toBe(1);
    });

    it('challenges binary execution bin/lumen.js: checks --help output duplication', () => {
      const procHelp = spawnSync(process.execPath, [BIN_PATH, '--help'], {
        encoding: 'utf-8',
        cwd: REPO_ROOT,
      });

      expect(procHelp.status).toBe(0);
      const commandsOccurrences = (procHelp.stdout.match(/Commands:/g) || []).length;
      expect(
        commandsOccurrences,
        `Expected "Commands:" to appear once, but appeared ${commandsOccurrences} times`
      ).toBe(1);
    });

    it('challenges binary execution bin/lumen.js: checks check --json produces valid parseable JSON without prefix text', () => {
      const procCheck = spawnSync(process.execPath, [BIN_PATH, 'check', '--json'], {
        encoding: 'utf-8',
        cwd: REPO_ROOT,
      });

      expect(procCheck.status).toBe(0);
      const trimmedOutput = procCheck.stdout.trim();

      // CHALLENGE: Is stdout valid parseable JSON directly, without non-JSON preamble like "Lumen CLI v0.3.4"?
      let parsedJson: unknown;
      let parseError: Error | null = null;
      try {
        parsedJson = JSON.parse(trimmedOutput);
      } catch (err: any) {
        parseError = err;
      }

      expect(
        parseError,
        `check --json stdout must be valid JSON without preamble, but failed: ${trimmedOutput}`
      ).toBeNull();
      expect(Array.isArray(parsedJson)).toBe(true);
    });
  });

  describe('Suite 3: Asset Manifest Recovery & Corruption Robustness', () => {
    it('handles carryPreviousBuildForward with null, undefined, or empty object gracefully', () => {
      const current: AssetManifest = {
        'bundle.js': 'assets/bundle.abc.js',
      };

      const fromNull = carryPreviousBuildForward(null, current);
      expect(fromNull).toEqual(current);
      expect(AssetManifestSchema.safeParse(fromNull).success).toBe(true);

      const fromUndefined = carryPreviousBuildForward(undefined, current);
      expect(fromUndefined).toEqual(current);
      expect(AssetManifestSchema.safeParse(fromUndefined).success).toBe(true);

      const fromEmpty = carryPreviousBuildForward({}, current);
      expect(fromEmpty).toEqual(current);
      expect(AssetManifestSchema.safeParse(fromEmpty).success).toBe(true);
    });

    it('challenges carryPreviousBuildForward when previousManifest is an Array or contains invalid types', () => {
      const current: AssetManifest = {
        'bundle.js': 'assets/bundle.abc.js',
      };

      // Array passed as previousManifest (in JS typeof [] === 'object')
      const arrayManifest = ['corrupt-entry-1', 'corrupt-entry-2'] as any;
      const mergedWithArray = carryPreviousBuildForward(arrayManifest, current);

      // CHALLENGE: If array keys '0', '1' leak into merged manifest, does AssetManifestSchema validate?
      // A robust manifest engine should sanitize or reject array input, preserving schema compliance
      const schemaCheck = AssetManifestSchema.safeParse(mergedWithArray);
      expect(
        schemaCheck.success,
        'Resulting manifest must conform to AssetManifestSchema even if previous was array'
      ).toBe(true);
    });

    it('recovers from truncated / corrupted manifest JSON string', () => {
      const corruptedJson = '{"app.js": "assets/app.123.js", "missing_closing_brace":';
      let recoveredManifest: AssetManifest;

      try {
        recoveredManifest = JSON.parse(corruptedJson);
      } catch {
        // Fallback to fresh clean manifest
        recoveredManifest = {};
      }

      const current: AssetManifest = {
        'app.js': 'assets/app.new.js',
      };

      const finalManifest = carryPreviousBuildForward(recoveredManifest, current);
      expect(finalManifest['app.js']).toBe('assets/app.new.js');
      expect(AssetManifestSchema.safeParse(finalManifest).success).toBe(true);
    });
  });

  describe('Suite 4: Multilingual Token Indexing Across Latin, Cyrillic, and CJK', () => {
    it('tokenizes mixed multilingual text including Latin, Cyrillic, and CJK ideographs', () => {
      const mixedText = 'Omnitron Квантовая Механика 2026 量子コンピューティング neural-net';
      const tokens = tokenizeMultilingual(mixedText);

      expect(tokens).toContain('omnitron');
      expect(tokens).toContain('квантовая');
      expect(tokens).toContain('механика');
      expect(tokens).toContain('2026');
      expect(tokens).toContain('量子コンピューティング');
      expect(tokens).toContain('neural');
      expect(tokens).toContain('net');
    });

    it('normalizes NFKC unicode ligatures and compatibility characters', () => {
      // 'ﬁ' (U+FB01) should decompose to 'fi', full-width 'ＡＢＣ' to 'abc'
      const text = 'ﬁle ＡＢＣ';
      const tokens = tokenizeMultilingual(text);

      expect(tokens).toContain('file');
      expect(tokens).toContain('abc');
    });

    it('indexes documents with empty/missing properties without inserting "undefined" tokens', async () => {
      const corpus = new CorpusGraph();
      const config = defineLumenConfig({ title: 'Search Test' });

      corpus.addDocument({
        id: 'sparse-doc',
        path: 'docs/sparse.pdx',
        title: '', // empty title
        routePath: '/docs/sparse',
        anchors: [],
        mathObjects: [],
        backlinks: [],
      });

      const searchIndex = await generateSearchIndex(corpus, config);
      expect(searchIndex.entries).toHaveLength(1);
      const entry = searchIndex.entries[0];

      // CHALLENGE: 'undefined' string must NOT appear in search tokens
      expect(entry.tokens).not.toContain('undefined');
    });
  });
});
