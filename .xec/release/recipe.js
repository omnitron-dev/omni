import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseCommand } from '@xec-sh/ops/release';
import {
  assertReleaseProducerApi, preparationBuildDirectory, prepareReleaseArchive,
  releaseInstallArgs, releaseProducerInputs, verifyPreparationRuntime,
} from './build.js';
import policy from '../release-policy.mjs';

/** Build, packing and acceptance have distinct inputs but one immutable archive batch. */
export async function releasePreparation(root, commit, context) {
  assertReleaseProducerApi();
  const cli = fileURLToPath(new URL('../bin/xec', import.meta.resolve('@xec-sh/cli')));
  return {
    build: { executable: process.execPath,
      args: [cli, 'release-build', '--source', root, '--revision', commit],
      timeoutMs: policy.preparation.recipeTimeoutMs },
    run(cwd, executable, args, options) {
      if (executable === 'pnpm' && args[0] === 'install')
        assert.deepEqual(args, releaseInstallArgs, 'Preparation install differs from the independent build contract');
      return releaseCommand(cwd, executable, args, { ...options, envMode: 'replace', env: { ...context.env, ...options?.env } });
    },
    prepareArchive: archive => prepareReleaseArchive(archive, commit),
    retainProducer: {
      policy: createHash('sha256').update(JSON.stringify(context.identity.policy)).digest('hex'),
      inputs: await releaseProducerInputs(root, context),
      async verify({ source, artifacts, run, signal }) {
        // A verified runtime is useful for build1 reproduction, not authority to publish.
        await verifyPreparationRuntime(preparationBuildDirectory(root, commit), context.identity);
        const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'omnitron-release-accept-'));
        try {
          const manifest = path.join(temporary, 'archives.json'), consumer = path.join(temporary, 'consumer');
          await fs.writeFile(manifest, JSON.stringify(artifacts), { flag: 'wx', mode: 0o600 });
          await run(source, 'pnpm', releaseInstallArgs, { signal, timeoutMs: 600_000 });
          const env = { ...context.env, OMNITRON_HOME: path.join(temporary, 'home') };
          await run(source, process.execPath, [cli, 'check-packages', '--archives', manifest, '--install-consumer', consumer],
            { signal, env, timeoutMs: policy.preparation.consumerTimeoutMs });
          await run(source, process.execPath, ['scripts/ci/check-runtime-consumer.mjs', consumer],
            { signal, env, timeoutMs: 20 * 60_000 });
        } finally { await fs.rm(temporary, { recursive: true, force: true }); }
      },
    },
    progress: console.log,
    onEvent(event) { if (event.type === 'command-output') process[event.stream].write(event.text); },
  };
}
