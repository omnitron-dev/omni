/**
 * omnitron deploy build <app> — Build deployment artifact (tarball)
 *
 * `deploy app` and `rollback` are refused here. Both used to call
 * `restartApp` on a remote daemon — the same call, under two names, each
 * announcing an operation it did not perform. Deployment is
 * `omnitron stack start`; see the notes on each function.
 */

import { log } from '@xec-sh/kit';
import { spinner } from './spinner.js';

/**
 * Build a deployment artifact for an app.
 * Uses DependencyAnalyzer to find all workspace deps and ArtifactBuilder to create tarball.
 */
export async function projectBuildCommand(app: string): Promise<void> {
  const { loadEcosystemConfig } = await import('../config/loader.js');
  const { DependencyAnalyzer } = await import('../project/dependency-analyzer.js');
  const { ArtifactBuilder } = await import('../project/artifact-builder.js');

  const config = await loadEcosystemConfig();
  const entry = config.apps.find((a) => a.name === app);
  if (!entry) {
    log.error(`Unknown app: ${app}. Available: ${config.apps.map((a) => a.name).join(', ')}`);
    return;
  }

  const cwd = process.cwd();
  const s = spinner();

  // Step 1: Analyze workspace dependencies
  s.start(`Analyzing workspace dependencies for '${app}'...`);
  const analyzer = new DependencyAnalyzer(cwd);
  const appPath = entry.bootstrap
    ? entry.bootstrap.replace(/\/src\/.*$/, '')
    : entry.script?.replace(/\/src\/.*$/, '') ?? `apps/${app}`;
  const graph = analyzer.analyze(appPath);
  s.stop(`Found ${graph.workspaceDeps.length} workspace dependencies`);

  log.info(`  App: ${graph.app.name} (${graph.app.relativePath})`);
  for (const dep of graph.workspaceDeps) {
    log.info(`  Dep: ${dep.name} (${dep.relativePath})${dep.hasDist ? '' : ' [no dist/]'}`);
  }
  log.info(`  External: ${graph.externalDeps.length} npm packages`);

  // Step 2: Build artifact
  s.start(`Building artifact for '${app}'...`);
  const builder = new ArtifactBuilder(cwd);
  const artifact = await builder.buildApp(entry);
  s.stop(`Artifact built: ${artifact.path}`);

  const sizeMb = (artifact.size / 1024 / 1024).toFixed(2);
  log.info(`  Version: ${artifact.version}`);
  log.info(`  Size: ${sizeMb} MB`);
  log.info(`  Checksum: ${artifact.checksum.slice(0, 16)}...`);
  log.info(`  Built at: ${artifact.builtAt}`);
}

/**
 * `omnitron deploy app <app> --target <server>` — refused, with directions.
 *
 * What this used to do: connect to the remote daemon and call
 * `restartApp({ name: app })`, then print `Deployed '<app>' to <alias>`. No
 * artifact was built, nothing was transferred, nothing was installed. The
 * `--strategy rolling|blue-green|canary` and `--version` flags were accepted
 * and read by nothing.
 *
 * `rollback` was the SAME call — byte for byte the same operation under a
 * different name — and printed `Rolled back`. A rollback is a control you
 * reach for when something is already wrong; discovering at that moment that
 * it only restarts the version you are trying to get away from is the most
 * expensive time to discover it.
 *
 * Deployment in this system is a STACK operation, and it is implemented:
 * `stack start` provisions the node, builds and ships the artifact over SSH,
 * installs dependencies and verifies health. This command belonged to a
 * different, unfinished model — one app to one server by alias — that never
 * had a deployer behind it.
 *
 * Refusing rather than silently restarting: a refusal costs a command that
 * did not work anyway, and it says where the working one is. See
 * `remoteRestartCommand` for the behaviour this used to have, under its own
 * name.
 */
export async function deployCommand(app: string, opts: { target: string }): Promise<void> {
  log.error(
    `\`omnitron deploy\` does not deploy: it only restarted an app that was already on the host.`,
  );
  log.info('');
  log.info('Deployment is a stack operation — it provisions the node, ships the');
  log.info('artifact over SSH, installs dependencies and verifies health:');
  log.info('');
  log.info('    omnitron stack start <project> <stack>');
  log.info('');
  log.info(`To restart '${app}' on a registered remote server, which is what this`);
  log.info('command actually did:');
  log.info('');
  log.info(`    omnitron remote restart ${opts.target || '<alias>'} ${app}`);
  log.info('');
  log.info('To build an artifact without shipping it:');
  log.info('');
  log.info(`    omnitron deploy build ${app}`);
}

/**
 * `omnitron rollback <app>` — refused.
 *
 * It called `restartApp` — the identical operation to `deploy`, restarting
 * the running version. There is no version history behind this path to roll
 * back to. `RemoteDeployer` does keep artifacts per version, under
 * `/opt/omnitron/artifacts/<project>/<app>/<version>/`, so a real rollback is
 * implementable — but it has to move the deployed version, not restart it,
 * and it has to run through the stack path that put them there.
 */
export async function rollbackCommand(app: string, _opts: { target: string }): Promise<void> {
  log.error(
    `\`omnitron rollback\` does not roll back: it restarted the running version of '${app}'.`,
  );
  log.info('');
  log.info('No previous version is selected or restored by this path. Artifacts are');
  log.info('kept per version on the node, under');
  log.info('');
  log.info('    /opt/omnitron/artifacts/<project>/<app>/<version>/');
  log.info('');
  log.info('so a rollback is implementable through the stack deployer, and is not');
  log.info('implemented yet. Until it is, redeploy the version you want:');
  log.info('');
  log.info('    omnitron stack start <project> <stack>');
}

