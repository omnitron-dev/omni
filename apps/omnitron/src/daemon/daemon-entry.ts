/**
 * Daemon entry point — spawned as a detached child process by `omnitron up`.
 *
 * Resolves config from registered projects or CWD.
 * Reads saved daemon config (~/.omnitron/config.json) for role/master settings.
 * Daemon can start with default config if no projects registered.
 */

import { loadDaemonBootConfig } from '../config/loader.js';
import { DEFAULT_DAEMON_CONFIG } from '../config/defaults.js';
import { effectiveBindHost } from './daemon.js';
import { ProjectRegistry } from '../project/registry.js';
import { OmnitronDaemon } from './daemon.js';
import { readSavedDaemonConfig, ensurePersistedJwtSecret } from '../commands/up.js';
import { getEnv } from '../shared/env-config.js';

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
    ...(savedConfig
      ? {
          role: savedConfig.role,
          ...(savedConfig.master ? { master: savedConfig.master } : {}),
          // Persisted alongside role/master because the daemon boots from the
          // saved config, not the project's ecosystem file — a `trustProxy`
          // set only in the latter never reached the running daemon.
          ...(savedConfig.httpRateLimit ? { httpRateLimit: savedConfig.httpRateLimit } : {}),
          // The transport settings, for the same reason and by the same
          // route. Without these `daemon.host` was documented, meaningful to
          // the code that reads it, and unreachable from any file an operator
          // or a provisioning run could write.
          // Not `savedConfig.host` directly: a slave with no host set must
          // bind where a master can reach it, and that decision can only be
          // made here, while "unset" is still distinguishable from
          // "127.0.0.1, deliberately".
          host: effectiveBindHost(savedConfig),
          ...(savedConfig.port ? { port: savedConfig.port } : {}),
          ...(savedConfig.httpPort ? { httpPort: savedConfig.httpPort } : {}),
          ...(savedConfig.advertiseHost ? { advertiseHost: savedConfig.advertiseHost } : {}),
        }
      : {}),
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
  //     Max restarts exceeded                        (main, priceverse)
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

// Supervisor-grade safety net. Node's default kills the process on an
// unhandled rejection — which is how a background log-flush bug (2026-07-11,
// LogCollectorService requeue stack-overflow) took down the whole control
// plane and every app under it. A leaked background promise must never kill
// the supervisor: log it loudly and keep running. Uncaught synchronous
// exceptions keep the default fatal behaviour (state may be corrupt; the OS
// service respawns us and boot-time stack resume + the enabled-stacks
// reconciler restore the apps).
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  console.error(`[daemon] Unhandled rejection (continuing): ${err.stack ?? err.message}`);
});

main().catch((err) => {
  console.error('Daemon fatal error:', err);
  process.exit(1);
});
