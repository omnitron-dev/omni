/**
 * A chunk the last deployment took away.
 *
 * On daos/test on 2026-09-29 the owner's /admin/config answered «error
 * loading dynamically imported module: …/assets/config-CUEyrA2c.js» — a chunk
 * of the build the tab had loaded before release d531ab26, 404 on the new
 * build directory, intact in the previous one on the same disk. Testers met it
 * on every tab older than the deployment.
 *
 * `carryForwardScript` runs on the node after a build is unpacked. These cases
 * run the very script with bash on a temporary tree: the files it links, the
 * list it writes, the directories it removes — the behaviour, not the text.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { carryForwardScript, readGatewayMounts } from '../../src/services/static-carry-forward.js';

let root = '';
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

const hex = (n: number) => n.toString(16).padStart(16, '0');
/** A build directory `<root>/<16 hex>` with these asset files, `ageMin` minutes old. */
function build(n: number, assets: string[], ageMin = 0, own?: string[]): string {
  const dir = join(root, hex(n));
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), `build ${n}`);
  for (const a of assets) writeFileSync(join(dir, 'assets', a), `${n}:${a}`);
  if (own) writeFileSync(`${dir}.own-assets`, `${own.join('\n')}\n`);
  writeFileSync(`${dir}.delivered`, hex(n));
  const t = new Date(Date.now() - ageMin * 60_000);
  utimesSync(dir, t, t);
  return dir;
}
const run = (script: string) => execFileSync('bash', ['-c', script], { encoding: 'utf8' }).trim();

describe('a tab from before the deployment keeps its chunks', () => {
  it('links the served build’s own assets into the new one, and lists the new one’s own', () => {
    root = mkdtempSync(join(tmpdir(), 'carry-'));
    const prev = build(1, ['config-CUEyrA2c.js', 'index-OLD.js', 'shared-SAME.js'], 10, ['config-CUEyrA2c.js', 'index-OLD.js', 'shared-SAME.js']);
    const fresh = build(2, ['config-DPUvktz-.js', 'index-B9zhn-LD.js', 'shared-SAME.js']);
    const said = run(carryForwardScript({ root, fresh, serving: [prev], mounted: [prev], keep: 5 }));

    expect(said).toBe('carried 2 from 1 build(s); pruned 0 build(s)');
    expect(existsSync(join(fresh, 'assets', 'config-CUEyrA2c.js'))).toBe(true);
    // A link, not a copy: the same inode, no space spent.
    expect(statSync(join(fresh, 'assets', 'config-CUEyrA2c.js')).ino).toBe(statSync(join(prev, 'assets', 'config-CUEyrA2c.js')).ino);
    // The new build's own file is never overwritten by the old one.
    expect(readFileSync(join(fresh, 'assets', 'shared-SAME.js'), 'utf8')).toBe('2:shared-SAME.js');
    // Its own list is written beside it — only what it brought.
    expect(readFileSync(`${fresh}.own-assets`, 'utf8').trim().split('\n').sort()).toEqual(['config-DPUvktz-.js', 'index-B9zhn-LD.js', 'shared-SAME.js']);
  });

  it('carries one generation: what the served build had itself carried stays behind', () => {
    root = mkdtempSync(join(tmpdir(), 'carry-'));
    const prev = build(1, ['own.js', 'carried-from-before.js'], 10, ['own.js']);
    const fresh = build(2, ['new.js']);
    run(carryForwardScript({ root, fresh, serving: [prev], mounted: [prev], keep: 5 }));
    expect(existsSync(join(fresh, 'assets', 'own.js'))).toBe(true);
    expect(existsSync(join(fresh, 'assets', 'carried-from-before.js'))).toBe(false);
  });

  it('a served build from before these lists existed is read by its directory', () => {
    root = mkdtempSync(join(tmpdir(), 'carry-'));
    const prev = build(1, ['a.js', 'b.css'], 10);
    const fresh = build(2, ['c.js']);
    expect(run(carryForwardScript({ root, fresh, serving: [prev], mounted: [prev], keep: 5 }))).toMatch(/^carried 2 /);
  });

  it('carries nothing from outside its root, nor from itself', () => {
    root = mkdtempSync(join(tmpdir(), 'carry-'));
    const fresh = build(2, ['c.js']);
    const said = run(carryForwardScript({ root, fresh, serving: [fresh, '/etc'], mounted: [], keep: 5 }));
    expect(said).toBe('carried 0 from 0 build(s); pruned 0 build(s)');
  });
});

/**
 * A second generation the rollback would have carried.
 *
 * `<dir>.own-assets` is the list of what a build brought itself, and it is
 * what the NEXT deployment reads to decide what to carry. One generation is
 * the whole design: carrying what was carried grows every build by every
 * build before it.
 *
 * A rollback runs this for a directory that is already on the node and has
 * already been carried INTO — its `assets/` holds another build's chunks as
 * hard links. Rewriting the list there records those as its own, and the next
 * deployment carries two generations out of it. So the list is written once
 * and never again for the same directory.
 */
describe('a build says what it brought itself, once', () => {
  it('keeps the first list when the same build is delivered again', () => {
    root = mkdtempSync(join(tmpdir(), 'carry-'));
    const prev = build(1, ['old-a.js', 'old-b.js']);
    const fresh = build(2, ['new.js']);
    // Delivery one: `fresh` records `new.js`, then takes the previous build's two.
    run(carryForwardScript({ root, fresh, serving: [prev], mounted: [prev], keep: 5 }));
    expect(readFileSync(`${fresh}.own-assets`, 'utf8').trim().split('\n').sort()).toEqual(['new.js']);
    expect(existsSync(join(fresh, 'assets', 'old-a.js'))).toBe(true);

    // Delivery two: the same build, asked for again — a rollback onto it.
    run(carryForwardScript({ root, fresh, serving: [prev], mounted: [prev], keep: 5 }));
    expect(
      readFileSync(`${fresh}.own-assets`, 'utf8').trim().split('\n').sort(),
      'the carried chunks were recorded as this build\'s own — the next deployment would carry two generations',
    ).toEqual(['new.js']);
  });

  it('still writes it for a build that has none yet', () => {
    root = mkdtempSync(join(tmpdir(), 'carry-'));
    const fresh = build(2, ['new.js']);
    rmSync(`${fresh}.own-assets`, { force: true });
    run(carryForwardScript({ root, fresh, serving: [], mounted: [], keep: 5 }));
    expect(readFileSync(`${fresh}.own-assets`, 'utf8').trim()).toBe('new.js');
  });
});

describe('builds nobody serves go', () => {
  it('keeps the newest, the new one and every mounted one; removes the rest with their markers', () => {
    root = mkdtempSync(join(tmpdir(), 'carry-'));
    const olds = [3, 4, 5, 6, 7, 8, 9, 10].map((n, i) => build(n, ['x.js'], 100 + i * 10)); // oldest last
    const stoppedStack = olds[7]!; // the oldest, but a stopped gateway still names it
    const serving = build(1, ['s.js'], 50);
    const fresh = build(2, ['f.js']);
    const said = run(carryForwardScript({ root, fresh, serving: [serving], mounted: [serving, stoppedStack], keep: 5 }));

    // Newest five by mtime: fresh, serving, olds[0..2]; plus the mounted oldest. Removed: olds[3..6].
    expect(said).toBe('carried 1 from 1 build(s); pruned 4 build(s)');
    for (const kept of [fresh, serving, olds[0]!, olds[1]!, olds[2]!, stoppedStack]) expect(existsSync(kept)).toBe(true);
    for (const gone of olds.slice(3, 7)) {
      expect(existsSync(gone)).toBe(false);
      expect(existsSync(`${gone}.delivered`)).toBe(false);
    }
  });

  it('never removes anything that is not a build directory', () => {
    root = mkdtempSync(join(tmpdir(), 'carry-'));
    mkdirSync(join(root, 'not-a-build'));
    writeFileSync(join(root, 'notes.txt'), 'keep me');
    const fresh = build(2, ['f.js']);
    run(carryForwardScript({ root, fresh, serving: [], mounted: [], keep: 1 }));
    expect(existsSync(join(root, 'not-a-build'))).toBe(true);
    expect(existsSync(join(root, 'notes.txt'))).toBe(true);
  });
});

describe('a rehearsal changes nothing', () => {
  it('names what would go, links and removes nothing', () => {
    root = mkdtempSync(join(tmpdir(), 'carry-'));
    const olds = [3, 4, 5].map((n, i) => build(n, ['x.js'], 100 + i * 10));
    const prev = build(1, ['old.js'], 50, ['old.js']);
    const fresh = build(2, ['f.js']);
    const said = run(carryForwardScript({ root, fresh, serving: [prev], mounted: [prev], keep: 2, dryRun: true }));
    expect(said).toContain('would carry 1 from 1 build(s); would prune 3 build(s)');
    expect(existsSync(join(fresh, 'assets', 'old.js'))).toBe(false);
    for (const d of olds) expect(existsSync(d)).toBe(true);
    expect(existsSync(`${fresh}.own-assets`)).toBe(false);
  });
});

describe('what the node says its gateways mount', () => {
  it('running ones are served, all of them are kept', () => {
    expect(readGatewayMounts('true /opt/omnitron/stack-static/gateway/7f7e84ba1aa18ad6\nfalse /opt/omnitron/stack-static/gateway/0d98bee79c410715\n\n')).toEqual({
      serving: ['/opt/omnitron/stack-static/gateway/7f7e84ba1aa18ad6'],
      mounted: ['/opt/omnitron/stack-static/gateway/7f7e84ba1aa18ad6', '/opt/omnitron/stack-static/gateway/0d98bee79c410715'],
    });
  });
});
