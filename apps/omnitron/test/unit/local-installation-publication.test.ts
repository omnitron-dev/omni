import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { create } from 'tar';
import { CLOSURE_FILE } from '../../src/release/application-closure.js';
import { inspectLocalReleaseInstallation } from '../../src/release/local-installation.js';
import { loadRelease, type LoadedRelease } from '../../src/release/load.js';
import { releaseTreeDigest, RELEASE_RECEIPT } from '../../src/release/runtime-provenance.js';
import { targetRuntime } from '../../src/release/target-runtime.js';
import { readInstalledReleaseReceipt, writeInstalledReleaseReceipt, type InstalledReleaseReceipt } from '../../src/release/installed-origin.js';

let directory: string, root: string, release: LoadedRelease, receipt: InstalledReleaseReceipt;
let preparation: { prepare: true; ownerPid: number; ownerPackage: string };
const entries = [{ name: 'worker', script: 'main.js' }];
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'local-publication-')));
  const source = path.join(directory, 'source');
  await fs.mkdir(source, { mode: 0o700 });
  await fs.writeFile(path.join(source, 'main.js'), 'export default 1;');
  const runtime = await targetRuntime();
  const closure = JSON.stringify({ protocol: 1, runtime, nodeOptions: '',
    payloadSha256: await releaseTreeDigest(source, true, false, [CLOSURE_FILE]) });
  await fs.writeFile(path.join(source, CLOSURE_FILE), closure, { mode: 0o600 });
  const store = path.join(directory, 'releases'), published = path.join(store, 'fixture');
  await fs.mkdir(path.join(published, 'artifacts'), { recursive: true });
  const archive = path.join(published, 'artifacts/worker-1.0.0.tar.gz');
  await create({ file: archive, cwd: source, gzip: true }, ['main.js', CLOSURE_FILE]);
  const bytes = await fs.readFile(archive);
  const manifest = { id: 'fixture', project: { repo: 'fixture-project', commit: 'a'.repeat(40) },
    omni: { repo: 'fixture-framework', commit: 'b'.repeat(40) }, builtAt: new Date().toISOString(),
    gates: [{ name: 'fixture', status: 'passed' }], builtWith: { omnitron: '0.3.1', packages: [], target: runtime },
    artifacts: [{ app: 'worker', version: '1.0.0', bytes: bytes.length, sha256: hash(bytes),
      launch: { mode: 'script', file: 'main.js', closureSha256: hash(closure) } }] };
  await fs.writeFile(path.join(published, 'manifest.json'), JSON.stringify(manifest));
  release = await loadRelease('fixture', store);
  preparation = { prepare: true, ownerPid: process.pid, ownerPackage: source };
  const [installed] = await inspectLocalReleaseInstallation(release, 'local', entries, preparation);
  root = installed!.releaseRoot!;
  receipt = await readInstalledReleaseReceipt(root);
  await fs.unlink(path.join(root, RELEASE_RECEIPT));
});

afterEach(async () => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  await fs.rm(directory, { recursive: true, force: true });
});

/** Publish after the real tree walk takes its initial directory metadata.
 * First two reads belong to payload verification; the third starts the seal.
 * No digest, filesystem result or verification failure is mocked. */
function duringSeal(action: () => Promise<void>) {
  const original = fs.lstat.bind(fs);
  let reads = 0, invoked = false;
  vi.spyOn(fs, 'lstat').mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
    const value = await original(...args);
    if (args[0] === root && args[1]?.bigint && ++reads === 3) {
      invoked = true;
      await action();
    }
    return value;
  }) as typeof fs.lstat);
  syncBuiltinESMExports();
  return () => expect(invoked, 'publication must occur during the seal digest').toBe(true);
}

it('revalidates an exact receipt published during the seal tree walk', async () => {
  const occurred = duringSeal(() => writeInstalledReleaseReceipt(root, receipt));
  const [installed] = await inspectLocalReleaseInstallation(release, 'local', entries, preparation);
  occurred();
  expect(installed!.releaseRoot).toBe(root);
  expect(await readInstalledReleaseReceipt(root)).toEqual(receipt);
});

it('refuses a different published origin after the same race', async () => {
  receipt.origin.frameworkCommit = 'c'.repeat(40);
  receipt.installedFrameworkCommit = receipt.origin.frameworkCommit;
  const occurred = duringSeal(() => writeInstalledReleaseReceipt(root, receipt));
  await expect(inspectLocalReleaseInstallation(release, 'local', entries, preparation)).rejects.toThrow('Local installed origin changed');
  occurred();
});

it('refuses changed payload even when a complete exact receipt was published', async () => {
  const occurred = duringSeal(async () => {
    await writeInstalledReleaseReceipt(root, receipt);
    await fs.writeFile(path.join(root, 'main.js'), 'export default 2;');
  });
  await expect(inspectLocalReleaseInstallation(release, 'local', entries, preparation)).rejects.toThrow('Frozen release files differ from the admitted payload');
  occurred();
});

it('does not retry a tree mutation without a published receipt', async () => {
  const occurred = duringSeal(async () => {
    await fs.writeFile(path.join(root, 'unexpected.js'), 'export default 2;');
  });
  await expect(inspectLocalReleaseInstallation(release, 'local', entries, preparation)).rejects.toThrow('Release tree changed during verification');
  occurred();
});

it('still compares the admitted payload when a peer seals modified bytes', async () => {
  const occurred = duringSeal(async () => {
    await fs.writeFile(path.join(root, 'main.js'), 'export default 2;');
    receipt.treeSha256 = await releaseTreeDigest(root);
    await writeInstalledReleaseReceipt(root, receipt);
  });
  await expect(inspectLocalReleaseInstallation(release, 'local', entries, preparation)).rejects.toThrow('Frozen release files differ from the admitted payload');
  occurred();
});
