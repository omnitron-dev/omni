import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as release from '@xec-sh/ops/release';
import { checkPackageArchives } from '../release/packages.js';
import { assertReleaseProducerApi, prepareReleaseArchive } from '../release/build.js';

/** CI produces one batch; release acceptance supplies the already retained batch. */
export async function checkPackages(root, values = {}) {
  if (values.archives && values.revision) throw Error('--archives and --revision cannot be combined');
  if (!values.archives) assertReleaseProducerApi();
  const revision = values.archives ? undefined : await release.releaseCommand(root, 'git', ['rev-parse', 'HEAD']);
  if (revision !== undefined && (!/^[a-f0-9]{40}$/.test(revision) || values.revision && values.revision !== revision))
    throw Error('Package producer source revision differs from HEAD');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'omnitron-package-check-'));
  try {
    const artifacts = values.archives
      ? JSON.parse(await fs.readFile(path.resolve(values.archives), 'utf8'))
      : await release.packReleaseArtifacts(root, temporary, await release.discoverReleasePackages(root), {
        prepareArchive: context => prepareReleaseArchive(context, revision),
      });
    if (!Array.isArray(artifacts) || artifacts.some(artifact => !artifact ||
      typeof artifact.name !== 'string' || typeof artifact.version !== 'string' ||
      typeof artifact.file !== 'string' || !path.isAbsolute(artifact.file) ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/.test(artifact.integrity)))
      throw Error('Invalid release archive inventory');
    await checkPackageArchives(root, artifacts, { consumer: values.installConsumer });
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

export function command(program) {
  program.command('check-packages').description('Verify package exports and consumers against one exact archive batch')
    .addOption(program.createOption('--archives <manifest>', 'JSON inventory from the retained producer; never repack').conflicts('revision'))
    .option('--revision <sha>', 'Exact source provenance for a fresh CI archive batch')
    .option('--install-consumer <directory>', 'Create and verify an independent npm runtime consumer')
    .allowExcessArguments(false)
    .action(values => checkPackages(process.cwd(), values));
}
