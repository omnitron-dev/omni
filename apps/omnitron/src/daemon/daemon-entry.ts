/**
 * Daemon entry point — spawned as a detached child process by `omnitron up`.
 *
 * Resolves config from registered projects or CWD.
 * Reads saved daemon config (~/.omnitron/config.json) for role/master settings.
 * Daemon can start with default config if no projects registered.
 */

import { loadDaemonBootConfig } from '../config/loader.js';
import { DEFAULT_DAEMON_CONFIG } from '../config/defaults.js';
import { ProjectRegistry } from '../project/registry.js';
import { OmnitronDaemon } from './daemon.js';
import { readSavedDaemonConfig, savedDaemonOverrides, ensurePersistedJwtSecret } from '../commands/up.js';
import { getEnv } from '../shared/env-config.js';
import { runtimeDiagnostics } from '../monitoring/runtime-diagnostics.js';

async function main() {
  const env = getEnv();
  const cwd = env.OMNITRON_CWD ?? process.cwd();
  process.chdir(cwd);

  // Single-instance guard. `omnitron up` checks the pid file BEFORE forking,
  // but a supervisor (launchd/systemd via `omnitron service install`) execs
  // this entry directly — without the guard a service start racing a manually
  // forked daemon would double-bind the socket and crash-loop. Exit 0 (clean)
  // so a KeepAlive={SuccessfulExit:false} supervisor doesn't respawn against
  // a healthy foreign daemon.
  {
    const { PidManager } = await import('./pid-manager.js');
    const { expandPath } = await import('../shared/paths.js');
    const pidManager = new PidManager(expandPath(DEFAULT_DAEMON_CONFIG.pidFile));
    if (pidManager.isRunning()) {
      console.error(`Omnitron daemon already running (PID: ${pidManager.getPid()}) — exiting.`);
      process.exit(0);
    }
    pidManager.cleanupStale(expandPath(DEFAULT_DAEMON_CONFIG.socketPath));
  }

  const registry = ProjectRegistry.open();

  // Try auto-detect from CWD, then first registered project, then defaults
  const detected = registry.autoDetect(cwd);
  const projectName = detected?.name ?? registry.list()[0]?.name;
  const configPath = projectName ? registry.getConfigPath(projectName) : null;
  const config = await loadDaemonBootConfig(configPath, cwd);

  // Read saved daemon config for role/master settings.
  const savedConfig = readSavedDaemonConfig();
  // Resolve (and on first boot generate+persist) the JWT signing secret so the
  // console's sessions survive daemon restarts instead of 401-ing every RPC.
  // An explicit env/config-supplied secret still wins in daemon.module.ts.
  const jwtSecret = ensurePersistedJwtSecret();
  const dc = {
    ...DEFAULT_DAEMON_CONFIG,
    ...savedDaemonOverrides(savedConfig),
    auth: { ...DEFAULT_DAEMON_CONFIG.auth, jwtSecret },
  };

  // A node does not watch.
  //
  // Watch mode is what puts the orchestrator in `devMode`, and `devMode` is
  // what makes it build every bootstrap app with esbuild and then WATCH the
  // result. On a developer's machine that is the whole point. On a node it
  // is the opposite: nobody edits sources there, the only thing that
  // rewrites them is a deployment, and a deployment restarts what it
  // deployed — so the watcher's every firing is a second restart fighting
  // the first.
  //
  // Measured on the test node during a routine redeploy, in its own log:
  //
  //     esbuild rebuild detected — restarting        ×36
  //     Max restarts exceeded                        (main, quotes)
  //     Crash restart task rejected
  //
  // The apps came up because the deployment then started them itself, which
  // is how this stayed invisible: the end state was right and the path to
  // it was a crash loop, indistinguishable in the log from a real one.
  const isNode = dc.role === 'slave';
  const daemon = new OmnitronDaemon();
  await daemon.start(config, {
    noInfra: env.OMNITRON_NO_INFRA,
    noWatch: env.OMNITRON_NO_WATCH || isNode,
    watch: !env.OMNITRON_NO_WATCH && !isNode,
  }, dc);
}

// Capture failures before DI exists as well as during runtime. Titan's
// ProcessHost still owns classification, recovery and shutdown policy.
process.on('unhandledRejection', (reason) => {
  runtimeDiagnostics.failure('runtime.unhandled-rejection', 'An asynchronous task escaped its error boundary', reason);
});
process.on('uncaughtExceptionMonitor', (error) => {
  runtimeDiagnostics.record({ id: 'runtime.uncaught-exception', severity: 'critical', title: 'An exception escaped the process boundary', evidence: [],
    remedy: 'Inspect the failing component and supervisor recovery; do not assume in-memory state remains valid.' }, error);
});

main().catch((err) => {
  runtimeDiagnostics.record({ id: 'runtime.startup-failed', severity: 'critical', title: 'Daemon startup failed', evidence: [],
    remedy: 'Repair the reported startup dependency before restarting.' }, err);
  process.exit(1);
});
