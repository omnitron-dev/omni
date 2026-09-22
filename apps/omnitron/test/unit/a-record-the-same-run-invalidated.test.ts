/**
 * An app rebuilt with nothing changed, because its own run moved the inputs
 * it had just written down.
 *
 * Measured 2026-09-22 across two deployments of `daos/test`:
 *
 *     07:57:36  building main
 *     08:01:15  main's build record written — inputs 9463e320636e0319
 *     08:01:33  main: rebuilding @omnitron-dev/omnitron — src/… is newer
 *     08:01:54  main: rebuilding @omnitron-dev/titan — src/… is newer
 *     …         616 files under apps/omnitron/dist, 216 under titan/dist
 *     08:50     the same inputs measure c5fb6c99ecf39c44, nothing edited
 *     05:49:06  the next deployment: «building main — the inputs changed»
 *
 * The record was written between the compiler and the packer, and the packer
 * rebuilds a vendored package whose `dist` is stale — a directory that is
 * part of those very inputs. Five of six apps skipped on the next run; the
 * one that did not was the FIRST, the only one packed before those packages
 * were current.
 *
 * The packer already drops the memo entry for a package it rebuilds, which
 * is what saved apps two through six. It cannot save one that has already
 * recorded. So the record goes after the tarball, and what is pinned here is
 * that order — including on the reuse path, where a run that compiles
 * nothing can still rebuild a vendored package while packing.
 */

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripComments } from '../../../../scripts/lib/strip-comments.mjs';
import { ArtifactBuilder } from '../../src/project/artifact-builder.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const made: string[] = [];
afterAll(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

/** A project with one app that has a `dist`, and a builder over it. */
function builderOver(opts: { decision?: 'reuse' | 'build'; tarballThrows?: boolean } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-record-order-'));
  made.push(root);
  const appDir = path.join(root, 'apps', 'main');
  fs.mkdirSync(path.join(appDir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: 'main', version: '0.0.1' }));
  fs.writeFileSync(path.join(appDir, 'dist', 'index.js'), 'export default {}');

  const out = path.join(root, 'artifacts');
  const order: string[] = [];
  const builder = new ArtifactBuilder(root, out) as any;

  builder.decideRebuild = async () => {
    order.push('decide');
    return { action: opts.decision ?? 'build', because: 'measured' };
  };
  builder.runBuild = async () => {
    order.push('build');
  };
  builder.createTarball = async (_appDir: string, artifactPath: string) => {
    order.push('tarball');
    if (opts.tarballThrows) throw new Error('tar: Cannot open: No such file or directory');
    fs.writeFileSync(artifactPath, 'tarball');
    return 'c'.repeat(64);
  };
  builder.recordBuild = async () => {
    order.push('record');
  };

  return { builder, order, entry: { name: 'main', script: 'apps/main/dist/index.js' } };
}

describe('when a build writes down what it was built from', () => {
  it('records after the tarball, because packing can still move the inputs', async () => {
    const { builder, order, entry } = builderOver({ decision: 'build' });

    await builder.buildApp(entry);

    expect(order).toEqual(['decide', 'build', 'tarball', 'record']);
  });

  it('records on the reuse path too — that run can rebuild a vendored package as well', async () => {
    const { builder, order, entry } = builderOver({ decision: 'reuse' });

    await builder.buildApp(entry);

    expect(order).toEqual(['decide', 'tarball', 'record']);
  });

  it('records nothing when the tarball failed — there is no artifact to describe', async () => {
    const { builder, order, entry } = builderOver({ decision: 'build', tarballThrows: true });

    await expect(builder.buildApp(entry)).rejects.toThrow(/Cannot open/);

    expect(order).toEqual(['decide', 'build', 'tarball']);
    expect(order).not.toContain('record');
  });

  it('neither decides nor records when the caller says the build is not ours', async () => {
    const { builder, order, entry } = builderOver();

    await builder.buildApp(entry, { skipBuild: true });

    expect(order).toEqual(['tarball']);
  });
});

describe('the half of this that was already right', () => {
  it('drops the memo entry for a package it rebuilds while packing', () => {
    // Without this, apps two through six would have inherited the stale
    // hash as well, and every deployment would rebuild all six forever.
    const bundle = stripComments(
      fs.readFileSync(path.join(here, '../../src/services/bundle-builder.ts'), 'utf8'),
    );
    const rebuild = bundle.indexOf("'run', 'build'");
    const drop = bundle.indexOf('options.packCache?.delete(dir)');

    expect(drop).toBeGreaterThan(rebuild);
  });

  it('keeps the record after the tarball in the source, not only in this test', () => {
    const builder = stripComments(
      fs.readFileSync(path.join(here, '../../src/project/artifact-builder.ts'), 'utf8'),
    );
    const tarball = builder.indexOf('await this.createTarball(appDir, artifactPath, entry.name)');
    const record = builder.indexOf('await this.recordBuild(appDir)');

    expect(tarball).toBeGreaterThan(-1);
    expect(record).toBeGreaterThan(tarball);
  });
});
