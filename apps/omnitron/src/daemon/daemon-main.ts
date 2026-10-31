/**
 * Daemon entry point — spawned as a detached child process by `omnitron up`.
 *
 * Resolves config from registered projects or CWD.
 * Reads saved daemon config (~/.omnitron/config.json) for role/master settings.
 * Daemon can start with default config if no projects registered.
 */

import { DEFAULT_DAEMON_CONFIG } from '../config/defaults.js';
import { OmnitronDaemon } from './daemon.js';
import { loadStartupConfig } from './startup-config.js';
import { getEnv } from '../shared/env-config.js';
import { runtimeDiagnostics } from '../monitoring/runtime-diagnostics.js';
import { OWN_BUILD } from '../shared/build-stamp.js';
import { readBackendBootRecord } from './backend-handoff-types.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function main() {
  // Preflight must never open databases, listeners or start applications.
  if (process.argv[2] === '--check-backend') {
    process.stdout.write(JSON.stringify({ protocol: 1, schemaExpansionProtocol: 1, build: OWN_BUILD }) + '\n');
    return;
  }
  if (process.argv[2] === '--backend-handoff') {
    const record = await readBackendBootRecord(process.argv[3]);
    process.chdir(record.cwd);
    const daemon = new OmnitronDaemon();
    await daemon.start(record.state.watchConfig, { backendHandoff: record.state }, record.daemonConfig);
    process.send?.({ type: 'backend-ready', pid: process.pid, execution: daemon.backendRuntimeStatus(), build: OWN_BUILD });
    process.disconnect?.();
    return;
  }
  if (process.argv[2]) throw new Error(`Unsupported backend entry mode: ${process.argv[2]}`);
  const { forwardSelectedRuntime } = await import('./runtime-launcher.js');
  if (await forwardSelectedRuntime('daemon', process.argv[1]!, [])) return;
  const { withRuntimeStartup } = await import('./runtime-installation.js');
  await withRuntimeStartup(path.dirname(path.dirname(fileURLToPath(import.meta.url))), coldStart);
}

async function coldStart(): Promise<void> {
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

  const { config, daemonConfig: dc } = await loadStartupConfig(cwd);

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

await main().catch((err) => {
  runtimeDiagnostics.record({ id: 'runtime.startup-failed', severity: 'critical', title: 'Daemon startup failed', evidence: [],
    remedy: 'Repair the reported startup dependency before restarting.' }, err);
  throw err;
});
