/**
 * omnitron deploy <app> --target <server|tag> — Deploy app to remote server
 * omnitron deploy build <app> — Build deployment artifact (tarball)
 * omnitron rollback <app> --target <server> — Rollback to previous version
 */

import { log, spinner } from '@xec-sh/kit';
import { ServerRegistry } from '../infrastructure/server-registry.js';
import { createRemoteDaemonClient } from '../daemon/daemon-client.js';

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

export async function deployCommand(app: string, opts: { target: string }): Promise<void> {
  if (!opts.target) {
    log.error('--target is required (server alias or tag)');
    return;
  }

  const registry = new ServerRegistry();
  const servers = resolveTargetServers(registry, opts.target);

  if (servers.length === 0) {
    log.error(`No servers found for target '${opts.target}'`);
    return;
  }

  log.info(`Deploying '${app}' to ${servers.length} server(s): ${servers.map((s) => s.alias).join(', ')}`);

  for (const server of servers) {
    const s = spinner();
    s.start(`Deploying '${app}' to ${server.alias}...`);

    const client = createRemoteDaemonClient(server.host, server.port);
    try {
      const daemon = await client.service<import('../shared/dto/services.js').IDaemonService>('OmnitronDaemon');
      await daemon.restartApp({ name: app });
      s.stop(`Deployed '${app}' to ${server.alias}`);
    } catch (err) {
      s.stop(`Failed to deploy to ${server.alias}: ${(err as Error).message}`);
    }
    await client.disconnect();
  }
}

export async function rollbackCommand(app: string, opts: { target: string }): Promise<void> {
  if (!opts.target) {
    log.error('--target is required');
    return;
  }

  const registry = new ServerRegistry();
  const servers = resolveTargetServers(registry, opts.target);

  if (servers.length === 0) {
    log.error(`No servers found for target '${opts.target}'`);
    return;
  }

  for (const server of servers) {
    const s = spinner();
    s.start(`Rolling back '${app}' on ${server.alias}...`);

    const client = createRemoteDaemonClient(server.host, server.port);
    try {
      const daemon = await client.service<import('../shared/dto/services.js').IDaemonService>('OmnitronDaemon');
      await daemon.restartApp({ name: app });
      s.stop(`Rolled back '${app}' on ${server.alias}`);
    } catch (err) {
      s.stop(`Rollback failed on ${server.alias}: ${(err as Error).message}`);
    }
    await client.disconnect();
  }
}

function resolveTargetServers(registry: ServerRegistry, target: string) {
  // First try as alias
  const byAlias = registry.get(target);
  if (byAlias) return [byAlias];

  // Then try as tag
  return registry.list().filter((s) => s.tags.includes(target));
}
