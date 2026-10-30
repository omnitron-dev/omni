import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Netron } from '@omnitron-dev/titan/netron';
import { UnixSocketTransport } from '@omnitron-dev/titan/netron/transport/unix';
import { AuthenticationManager, AuthorizationManager } from '@omnitron-dev/titan/netron/auth';
import { ProcessManager, ControllerHandoff } from '@omnitron-dev/titan-pm';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { IEcosystemConfig, IDaemonConfig } from '../config/types.js';
import { OrchestratorService } from '../orchestrator/orchestrator.service.js';
import { FileWatcher } from '../orchestrator/file-watcher.js';
import { StateStore } from './state-store.js';
import { DaemonStateStore } from './daemon-state-store.service.js';
import { PidManager } from './pid-manager.js';
import { ExecutionJournal } from './execution-journal.js';
import { ExecutionHostService } from './execution-host.js';
import { executionProcessConfig, executionLogManager } from './execution-config.js';

/** A resident process, separate from the replaceable backend and its system workers. */
export async function startExecutionOwner(options: {
  directory: string;
  config: IEcosystemConfig;
  daemonConfig: IDaemonConfig;
  logger: ILogger;
  onShutdownRequested?: () => void;
}): Promise<{ stop(): Promise<void>; service: ExecutionHostService }> {
  const { directory, logger, daemonConfig } = options;
  let config = options.config;
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())) throw new Error('Execution directory must be private and owned by this user');
  const socket = path.join(directory, 'owner.sock');
  const pid = new PidManager(path.join(directory, 'owner.pid'));
  if (pid.isRunning()) throw new Error('Execution owner is already running; connect to it instead of replacing its processes');
  pid.cleanupStale(socket);
  pid.write();

  const journal = new ExecutionJournal(path.join(directory, 'controller.json'));
  const previous = await journal.read();
  const identity = { id: randomUUID(), pid: process.pid, startedAt: new Date().toISOString() };
  const grant = { ownerId: identity.id, controllerId: 'unclaimed', epoch: (previous?.grant.epoch ?? 0) + 1 };
  if (!Number.isSafeInteger(grant.epoch)) throw new Error('Execution epoch exhausted');
  await journal.write({ protocol: 1, owner: identity, grant });
  const fence = new ControllerHandoff(identity, grant, next => journal.write({ protocol: 1, owner: identity, grant: next }));
  const store = new DaemonStateStore(logger, path.join(directory, 'state.db'));
  const state = new StateStore(store);
  await state.init();
  const pm = new ProcessManager(logger, executionProcessConfig(config));
  const orchestrator = new OrchestratorService(logger, pm, state, undefined, { reapForeignOrphans: false, applicationRuntime: true });
  orchestrator.setConfig(config);
  const logs = executionLogManager(config, daemonConfig, orchestrator);
  orchestrator.onAppLog((app, line) => logs.appendToFile(app, line));
  let watcher: FileWatcher | null = null;

  const netron = new Netron(logger, { id: `execution-${identity.id}` });
  netron.registerTransport('unix', () => new UnixSocketTransport());
  netron.registerTransportServer('unix', { name: 'execution-owner', options: {
    path: socket, force: false, mode: 0o600, requestTimeout: 10 * 60_000,
  } });
  netron.configureAuth(new AuthenticationManager(logger, {
    authenticate: async () => { throw new Error('Execution control requires the private Unix socket'); },
    validateToken: async () => { throw new Error('Execution control does not accept bearer tokens'); },
    tokenCache: { enabled: false },
  }), new AuthorizationManager(logger));
  netron.setTransportAuthContext('unix', { userId: 'execution-local', roles: ['execution-controller'], permissions: [] });
  const service = new ExecutionHostService(orchestrator, fence, journal, {
    watch(enabled, apps) {
      watcher?.stop();
      watcher = null;
      if (enabled) {
        watcher = new FileWatcher(logger, orchestrator, config, process.cwd());
        watcher.start(apps);
      }
    },
    watchConfig(next) { config = next; watcher?.applyConfig(next); },
    watchedApps: () => watcher?.getWatchedApps() ?? [],
    ...(options.onShutdownRequested && { shutdown: options.onShutdownRequested }),
  });
  await netron.peer.exposeService(service);
  await netron.start();
  orchestrator.setDaemonNetron(netron, socket);
  let stopping: Promise<void> | null = null;
  return { service, stop() {
    stopping ??= (async () => {
      watcher?.stop();
      await orchestrator.stopAll(false);
      await pm.shutdown({ timeout: 30_000 });
      await state.flush();
      logs.dispose();
      await netron.stop();
      await store.dispose();
      pid.removeOwned();
    })();
    return stopping;
  } };
}
