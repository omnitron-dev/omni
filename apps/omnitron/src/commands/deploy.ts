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
    // It built nothing and exited 0, as the two refusals below did.
    process.exitCode = 1;
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
 * `omnitron deploy app <app>` — not implemented; says so, and where deployment is.
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
 * The refusal that replaced it was wrong in three places, measured
 * 2026-09-23. It exited 0, so a script took it for a deployment. It said the
 * remote path «has never been executed» and that «no project config declares
 * `stacks.nodes`» — while `daos/test` declares one node and the audit trail
 * held 28 `stack.start daos/test` rows from an operator, 5 of them that day.
 * And it sent the reader to `omnitron remote restart <alias>` — a restart,
 * not a deployment, on a registry that answered «No remote servers
 * registered». The `--target` flag existed only to fill in that line.
 *
 * What it says now is what works today: `stack start`, and for a stack that
 * takes releases only, the two commands its own refusal names
 * (`ProjectService`, «takes releases only»).
 */
export async function deployCommand(app: string): Promise<void> {
  log.error(`\`omnitron deploy app\` is not implemented: nothing was deployed.`);
  log.info('');
  log.info('Deployment is a stack operation:');
  log.info('');
  log.info('    omnitron stack start <project> <stack>');
  log.info('');
  log.info("A stack whose config says `release: { mode: 'required' }` takes releases only:");
  log.info('');
  log.info('    omnitron release build <project> --for <stack>');
  log.info('    omnitron stack start <project> <stack> --release <id>');
  log.info('');
  log.info('To build an artifact without shipping it:');
  log.info('');
  log.info(`    omnitron deploy build ${app}`);
  process.exitCode = 1;
}

/**
 * `omnitron rollback <app>` — not implemented; names the rollback that exists.
 *
 * It called `restartApp` — the identical operation to `deploy`, restarting
 * the running version. There is no version history behind this path.
 *
 * Its refusal, measured 2026-09-23, opened with «does not roll back: it
 * restarted the running version of 'main'» — read on its own, a report that
 * `main` had just been restarted, from a command that does nothing. It exited
 * 0. It said the stack deployer «has itself never been executed», against 28
 * operator `stack.start daos/test` rows in the audit trail. It said artifacts
 * «are kept per version on the node»: the node's path is
 * `/opt/omnitron/artifacts/<project>/<app>/<version>` (remote-deployer), the
 * version is the app's package.json version, and every app in all 23 release
 * manifests on this machine is 0.0.1 — one directory per app, which each
 * deployment overwrites (from the code; not checked on a node). And its
 * advice, `omnitron stack start <project> <stack>`, is refused without
 * `--release` by a stack that takes releases only, as `daos/test` does.
 *
 * The rollback that does exist is the release before, for a remote stack
 * (a local one takes no release: `admitRelease`). Releases are kept where
 * they were built or pulled, not on the node; `stack start --release` ships
 * the release's own artifacts, onto a running stack too
 * (`ProjectService.startStackOnce`: «putting a release onto a running stack
 * is the point»), and the node installs any artifact whose checksum differs
 * from what it has. So `release list`, then `stack start --release` with the
 * previous id, is the way back — read from the code, not exercised here as a
 * rollback.
 */
export async function rollbackCommand(app: string): Promise<void> {
  log.error(`\`omnitron rollback\` is not implemented: nothing was done to '${app}'.`);
  log.info('');
  log.info('The way back for a remote stack is the previous release:');
  log.info('');
  log.info('    omnitron release list');
  log.info('    omnitron stack start <project> <stack> --release <previous-release-id>');
  log.info('');
  log.info("The project checkout must be at that release's project commit");
  log.info('(`omnitron release show <id>` names it); `stack start` refuses, naming it, when it is not.');
  process.exitCode = 1;
}

