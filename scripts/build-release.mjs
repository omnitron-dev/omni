/** Xec prepares an exact private source export; this recipe verifies its provenance. */
import path from 'node:path';
import os from 'node:os';
import { existsSync, realpathSync, mkdtempSync, rmSync } from 'node:fs';
import { Pipeline } from '@xec-sh/ops/pipeline';
import { releaseCommand } from '@xec-sh/ops/release';

const [source, commit] = globalThis.args ?? process.argv.slice(2);
const destination = realpathSync(process.cwd());
if (!source || !/^[a-f\d]{40}$/.test(commit) || realpathSync(source) === destination ||
    existsSync(path.join(destination, '.git'))) throw Error('Expected an isolated source export and full commit');

const git = (...args) => releaseCommand(destination, 'git', args);
await git('init', '--quiet');
await git('fetch', '--quiet', '--depth=1', '--no-tags', '--', realpathSync(source), commit);
if (await git('rev-parse', 'FETCH_HEAD') !== commit) throw Error('Release source identity differs');
await git('update-ref', 'HEAD', commit);
await git('read-tree', commit);
if (await git('status', '--porcelain')) throw Error('Exported source differs from the release commit');
const verification = mkdtempSync(path.join(os.tmpdir(), 'omnitron-release-consumer-'));
try {
  const consumer = path.join(verification, 'consumer');
  const pipeline = Pipeline.create('package-consumer-acceptance')
    .step('build', { run: { command: 'pnpm', args: ['run', 'build'], shell: false, cwd: destination }, timeout: 30 * 60_000 })
    .step('consumer-install', { dependsOn: ['build'], run: {
      command: process.execPath, args: ['scripts/check-package-exports.mjs', '--install-consumer', consumer], shell: false, cwd: destination,
    }, timeout: 20 * 60_000 })
    .step('consumer-runtime', { dependsOn: ['consumer-install'], run: {
      command: process.execPath, args: ['scripts/ci/check-runtime-consumer.mjs', consumer], shell: false, cwd: destination,
    }, timeout: 20 * 60_000 });
  const result = await pipeline.run({}, { onEvent(event) {
    if (event.type === 'step-output') process[event.stream].write(event.text);
    if (event.type === 'step-start') console.log(event.step + ' · running');
  } });
  if (!result.success) throw Error(result.steps.filter(step => !step.success).map(step => step.name + ': ' + step.error).join('\n'));
} finally {
  rmSync(verification, { recursive: true, force: true });
}
