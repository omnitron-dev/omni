/**
 * A packer that read the declaration instead of the install.
 *
 * daos declares every omni package as an ABSOLUTE link into the developer's
 * checkout — `"@omnitron-dev/omnitron": "link:/Users/…/omni/apps/omnitron"` —
 * while its lockfile records them relative, and a release is built in a
 * layout where the relative links land on a clean clone of omni
 * (`a-release-built-against-the-developers-omni`). The install was checked:
 * 98 of 98 links inside the clone. The packer never asked the install. It
 * read the declaration, found the developer's omni, and vendored THAT into
 * every artifact: on 2026-09-22 both releases of the day logged
 *
 *     main: rebuilding @omnitron-dev/omnitron — src/services/node-upgrade.service.ts
 *           is newer than anything in dist
 *
 * about a file edited in the working tree after the clone was made — and
 * rebuilt the running daemon's own `dist` in passing (275 files at 20:00:29
 * UTC), other sessions' uncommitted edits included.
 *
 * The rule: a linked package is found where it is INSTALLED, and a relative
 * declaration is resolved against its package, as pnpm does.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { linkedWorkspaceRoots } from '../../src/services/bundle-builder.js';

const made: string[] = [];
function tmp(): string {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'packer-')));
  made.push(d);
  return d;
}
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** An omni workspace with one package, at `root`. */
function omni(root: string): string {
  fs.mkdirSync(path.join(root, 'apps', 'omnitron'), { recursive: true });
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n");
  fs.writeFileSync(path.join(root, 'apps', 'omnitron', 'package.json'), '{"name":"@omnitron-dev/omnitron"}');
  return root;
}

describe('a packer that read the declaration', () => {
  it('finds a linked package where it is installed — the clone — not where it is declared', () => {
    const developers = omni(path.join(tmp(), 'omni'));
    const release = tmp();
    const clone = omni(path.join(release, 'omni'));
    const app = path.join(release, 'daos', 'apps', 'main');
    fs.mkdirSync(path.join(app, 'node_modules', '@omnitron-dev'), { recursive: true });
    // What pnpm made in the release layout: the link lands on the clone.
    fs.symlinkSync(path.join(clone, 'apps', 'omnitron'), path.join(app, 'node_modules', '@omnitron-dev', 'omnitron'));
    const manifest = { name: 'main', dependencies: { '@omnitron-dev/omnitron': `link:${developers}/apps/omnitron` } };

    expect(linkedWorkspaceRoots(manifest as never, app)).toEqual([clone]);
  });

  it('resolves a relative declaration against its package, not against this process', () => {
    const root = tmp();
    const theOmni = omni(path.join(root, 'omni'));
    const app = path.join(root, 'daos', 'apps', 'main');
    fs.mkdirSync(app, { recursive: true });
    const manifest = { name: 'main', dependencies: { '@omnitron-dev/omnitron': 'link:../../../omni/apps/omnitron' } };

    expect(linkedWorkspaceRoots(manifest as never, app)).toEqual([theOmni]);
  });

  it('falls back to the declaration when nothing is installed, as before', () => {
    const theOmni = omni(path.join(tmp(), 'omni'));
    const manifest = { name: 'main', dependencies: { '@omnitron-dev/omnitron': `link:${theOmni}/apps/omnitron` } };

    expect(linkedWorkspaceRoots(manifest as never, tmp())).toEqual([theOmni]);
  });
});
