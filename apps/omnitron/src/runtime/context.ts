import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createToken, type Token } from '@omnitron-dev/titan/nexus';
import { readInstalledReleaseReceipt, validRuntimeOrigin } from '../release/installed-origin.js';
import { releaseTreeDigest } from '../release/runtime-provenance.js';
import { releaseNodeOptions, targetRuntime } from '../release/target-runtime.js';

import { type ArtifactIdentity, parseArtifactIdentity, RuntimeOriginVerificationError } from './identity.js';

export type InstalledRuntimeContext =
  | Readonly<{
      state: 'verified';
      basis: 'verified-installed-runtime';
      producer: ArtifactIdentity;
      consumer: Readonly<{ releaseId: string; manifestSha256: string; app: string }>;
      entry: Readonly<{ relativeFile: string; mode: 'bootstrap' | 'script' }>;
      payloadSha256: string;
      executableSha256: string;
      observedAt: string;
      ownerAttestation: null;
    }>
  | Readonly<{ state: 'unavailable'; reason: string }>;
export const RUNTIME_CONTEXT: Token<InstalledRuntimeContext> =
  createToken<InstalledRuntimeContext>('omnitron.runtime-context');

/** Startup evidence for this physical compiled entry, not owner or continuous-memory attestation. */
export async function verifyInstalledRuntime(entry: URL): Promise<InstalledRuntimeContext> {
  try {
    if (!(entry instanceof URL) || entry.protocol !== 'file:' || entry.search || entry.hash)
      throw Error('Expected the actual compiled entry file URL');
    const file = fileURLToPath(entry);
    let root: string | undefined,
      directory = path.dirname(file);
    for (;;) {
      const exists = await fs.lstat(path.join(directory, '.omnitron-release.json')).then(
        () => true,
        (e) => {
          if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
          throw e;
        }
      );
      if (exists) {
        if (root) throw Error('Ambiguous nested installed-origin receipts');
        root = directory;
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    if (!root)
      return Object.freeze({ state: 'unavailable', reason: 'No admitted runtime origin is recorded for this entry' });
    if (!/\.[cm]?js$/.test(file) || (await fs.realpath(file)) !== file || !(await fs.lstat(file)).isFile())
      throw Error('Runtime entry must be a physical compiled file');
    const r = await readInstalledReleaseReceipt(root),
      origin = r.origin.runtimeOrigin;
    if (
      r.artifactPayloadUnchanged !== true ||
      r.frameworkContentUnchanged !== true ||
      r.installedFrameworkCommit !== r.origin.frameworkCommit
    )
      throw Error('Installed runtime binding changed');
    if (origin === undefined)
      return Object.freeze({ state: 'unavailable', reason: 'Legacy installation has no runtime-origin contract' });
    if (r.version !== 2 || !validRuntimeOrigin(origin)) throw Error('Invalid installed runtime-origin contract');
    if (process.env['NODE_PATH']) throw Error('Runtime extends NODE_PATH');
    const nodeOptions = releaseNodeOptions(process.env['NODE_OPTIONS']);
    // No inherited loader/preload can be represented by a permitted resource setting.
    if (process.execArgv.some((arg) => arg !== nodeOptions || !/^--max-old-space-size=[1-9][0-9]{0,6}$/.test(arg)))
      throw Error('Runtime command-line options are outside the verified installation');

    if (path.join(root, origin.entry.relativeFile) !== file)
      throw Error('Runtime entry differs from the admitted compiled entry');
    if (
      r.nodeOptions !== nodeOptions ||
      r.artifactPayloadUnchanged !== true ||
      r.frameworkContentUnchanged !== true ||
      r.installedFrameworkCommit !== r.origin.frameworkCommit
    )
      throw Error('Installed runtime binding changed');
    const target = await targetRuntime();
    if (!r.target || Object.entries(target).some(([k, v]) => r.target![k as keyof typeof target] !== v))
      throw Error('Runtime executable differs from the admitted target');
    if ((await releaseTreeDigest(root)) !== r.treeSha256) throw Error('Installed runtime payload changed');
    return Object.freeze({
      state: 'verified',
      basis: 'verified-installed-runtime',
      producer: parseArtifactIdentity({
        releaseId: r.origin.releaseId,
        manifestSha256: r.origin.manifestSha256,
        artifactSha256: r.origin.artifactSha256,
        producerApp: origin.producerApp,
        projectCommit: origin.projectCommit,
        frameworkCommit: r.origin.frameworkCommit,
      }),
      consumer: Object.freeze({ ...origin.consumer }),
      entry: Object.freeze({ ...origin.entry }),
      payloadSha256: r.treeSha256,
      executableSha256: target.executableSha256,
      observedAt: new Date().toISOString(),
      ownerAttestation: null,
    });
  } catch (error) {
    if (error instanceof RuntimeOriginVerificationError) throw error;
    throw new RuntimeOriginVerificationError(
      error instanceof Error ? error.message : 'Runtime origin verification failed',
      { cause: error }
    );
  }
}

/** A bootstrap child may load only compiled code from the same checked closure. */
export async function assertInstalledRuntimeModule(
  context: InstalledRuntimeContext,
  entry: URL,
  module: URL
): Promise<void> {
  if (context.state !== 'verified') return;
  try {
    const entryPath = fileURLToPath(entry);
    let root = entryPath;
    for (const _ of context.entry.relativeFile.split('/')) root = path.dirname(root);
    if (
      path.join(root, context.entry.relativeFile) !== entryPath ||
      module.protocol !== 'file:' ||
      module.search ||
      module.hash
    )
      throw Error('Runtime module does not belong to the admitted entry');
    const file = await fs.realpath(fileURLToPath(module));
    if (!file.startsWith(root + path.sep) || !/\.[cm]?js$/.test(file) || !(await fs.lstat(file)).isFile())
      throw Error('Runtime module is outside the installed compiled closure');
  } catch (error) {
    throw new RuntimeOriginVerificationError(
      error instanceof Error ? error.message : 'Runtime module verification failed',
      { cause: error }
    );
  }
}
