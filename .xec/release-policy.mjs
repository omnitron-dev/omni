/** Repository policy. Xec supplies execution; Omnitron supplies the release recipe. */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import semver from 'semver';

const policy = {
  repository: 'omnitron-dev/omni',
  branch: 'main',
  buildDependencies: [
    // Durable backup ownership uses the inspection/termination contract added
    // after Xec 0.12. Do not qualify a candidate against an older installed SDK.
    { workspace: 'apps/omnitron', name: '@xec-sh/core', range: '^0.13.0' },
  ],
  preparation: {
    consumerTimeoutMs: 60 * 60_000,
    recipeTimeoutMs: 120 * 60_000,
  },
  qualification: {
    provider: 'github',
    workflow: 'ci.yml',
    nativeWorkflow: 'qualify-managed-handoff.yml',
    nodes: ['22.23.4', '24.10.0'],
    jobs: ['Typecheck', 'Full workspace tests', 'Workspace lint', 'Reproduce the full backend and Console', 'Standing checks'],
    pollMs: 15_000,
    timeoutMs: 60 * 60_000,
  },
};

export default policy;

/** Refuse incompatible build inputs before version changes or expensive work. */
export async function assertBuildDependencies(root) {
  const inputs = [];
  for (const { workspace, name, range } of policy.buildDependencies) {
    const manifestPath = path.join(root, workspace, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const declared = manifest.dependencies?.[name];
    if (!semver.validRange(declared) || !semver.subset(declared, range)) {
      throw new Error(`${workspace} requires ${name} ${range} for this source; declared ${declared ?? '(missing)'}. ` +
        'Publish the required Xec contract, then update the dependency and frozen lockfile before preparing Omnitron.');
    }
    const require = createRequire(manifestPath);
    const installed = JSON.parse(await readFile(require.resolve(`${name}/package.json`), 'utf8'));
    if (installed.name !== name || !semver.satisfies(installed.version, range) || !semver.satisfies(installed.version, declared)) {
      throw new Error(`${workspace} resolves ${name}@${installed.version}, but this source requires ${range} ` +
        `and declares ${declared}. Install the reviewed frozen lockfile before building.`);
    }
    inputs.push({ workspace, name, declared, installed: installed.version });
  }
  return inputs;
}
