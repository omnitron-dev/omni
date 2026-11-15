/** Xec prepares an exact private source export; this recipe verifies its provenance. */
import path from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { Pipeline } from '@xec-sh/ops/pipeline';
import { releaseCommand } from '@xec-sh/ops/release';
import { assertPipelineSucceeded } from '../../scripts/lib/pipeline-result.mjs';
import { assertBuildDependencies } from '../release-policy.mjs';
import { releaseBuildContext, releaseDependencyBuildArgs, retainPreparationRuntime } from '../release/build.js';

export async function buildRelease(source, commit) {
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

  await assertBuildDependencies(destination);
  const context = await releaseBuildContext(destination, commit);
  context.env.OMNITRON_HOME = path.join(destination, '.release-artifacts/producer-home');
  const pipeline = Pipeline.create('release-producer')
    .step('dependency-preflight', { run: {
      command: process.execPath, args: ['scripts/undeclared-dependencies.mjs'], shell: false, cwd: destination, env: context.env, envMode: 'replace',
    }, timeout: 60_000 })
    .step('dependency-build', { dependsOn: ['dependency-preflight'], run: {
      command: 'pnpm', args: releaseDependencyBuildArgs, shell: false, cwd: destination, env: context.env, envMode: 'replace',
    }, timeout: 30 * 60_000 })
    .step('build', { dependsOn: ['dependency-build'], run: { command: 'pnpm', args: ['run', 'build'], shell: false, cwd: destination, env: context.env, envMode: 'replace' }, timeout: 30 * 60_000 });
  const result = await pipeline.run({}, { onEvent(event) {
    if (event.type === 'step-output') process[event.stream].write(event.text);
    if (event.type === 'step-start') console.log(event.step + ' · running');
  } });
  assertPipelineSucceeded(result);
  console.log('Retaining the unaccepted runtime from independent build 1/2');
  await retainPreparationRuntime(source, destination, context);
}

export function command(program) {
  program.command('release-build').description('Build an exact isolated producer without consumer checks or packing')
    .requiredOption('--source <path>', 'Clean source repository')
    .requiredOption('--revision <sha>', 'Exact committed source')
    .allowExcessArguments(false)
    .action(values => buildRelease(values.source, values.revision));
}

