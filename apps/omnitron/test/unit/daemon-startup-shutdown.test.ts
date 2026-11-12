import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Application, ShutdownReason } from '@omnitron-dev/titan';
import { createNullLogger, LOGGER_SERVICE_TOKEN } from '@omnitron-dev/titan/module/logger';
import { METRICS_SERVICE_TOKEN } from '@omnitron-dev/titan-metrics';
import { OmnitronDaemon } from '../../src/daemon/daemon.js';
import { DEFAULT_ECOSYSTEM, DEFAULT_DAEMON_CONFIG } from '../../src/config/defaults.js';
import {
  BACKUP_SERVICE_TOKEN, LOG_COLLECTOR_TOKEN, LOG_MANAGER_TOKEN,
  ORCHESTRATOR_TOKEN, PROJECT_SERVICE_TOKEN, STATE_STORE_TOKEN,
} from '../../src/shared/tokens.js';

const boundary = vi.hoisted(() => ({ connect: vi.fn(), control: vi.fn() }));
vi.mock('../../src/daemon/database-startup.js', () => ({ prepareDaemonDatabase: async () => undefined }));
vi.mock('../../src/daemon/execution-launcher.js', () => ({ connectExecutionOwner: boundary.connect }));
vi.mock('../../src/daemon/backend-control.js', () => ({ startBackendControl: boundary.control }));
vi.mock('../../src/daemon/daemon.module.js', () => ({
  createDaemonModule: () => class {},
  getDaemonLogStream: () => null,
  getDaemonErrorStream: () => null,
  getDaemonLogCollectorStream: () => null,
}));
vi.mock('../../src/config/saved.js', () => ({ readSavedDaemonConfig: () => ({ webapp: false }) }));
vi.mock('../../src/observability/index.js', () => ({
  MetricsBridge: class {},
  MetricsServer: class { async start() {} async stop() {} },
}));

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

let app: Application;
let directory: string;
let daemon: OmnitronDaemon;
let logger: ReturnType<typeof createNullLogger>;
let owner: { setLogger: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>;
  activateObservations: ReturnType<typeof vi.fn>; shutdownOwner: ReturnType<typeof vi.fn>; controllerId: string };
let control: { socket: string; stop: ReturnType<typeof vi.fn> };
let project: { dispose: ReturnType<typeof vi.fn>; startEnabledStacksReconciler: ReturnType<typeof vi.fn> };
let stopManaged: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'daemon-boot-stop-'));
  app = await Application.create({ disableCoreModules: true, environment: 'test' });
  vi.spyOn(Application, 'create').mockResolvedValue(app);
  logger = createNullLogger();
  vi.spyOn(logger, 'info');
  app.container.register<any>(LOGGER_SERVICE_TOKEN, { useValue: { logger, flush: async () => undefined } });
  stopManaged = vi.fn();
  app.container.register<any>(ORCHESTRATOR_TOKEN, { useValue: {
    stopAll: stopManaged, setTopologyDirectory: vi.fn(), setMetricsBridge: vi.fn(),
  } });
  app.container.register<any>(METRICS_SERVICE_TOKEN, { useValue: { stop: async () => undefined } });
  app.container.register<any>(LOG_MANAGER_TOKEN, { useValue: { flush: async () => undefined } });
  app.container.register<any>(LOG_COLLECTOR_TOKEN, { useValue: { dispose: async () => undefined } });
  app.container.register<any>(BACKUP_SERVICE_TOKEN, { useValue: { dispose: vi.fn() } });
  app.container.register<any>(STATE_STORE_TOKEN, { useValue: { clear: vi.fn() } });
  project = { dispose: vi.fn(), startEnabledStacksReconciler: vi.fn() };
  app.container.register<any>(PROJECT_SERVICE_TOKEN, { useValue: project });
  owner = { controllerId: 'fixture', setLogger: vi.fn(), close: vi.fn(),
    activateObservations: vi.fn(), shutdownOwner: vi.fn() };
  control = { socket: path.join(directory, 'control.sock'), stop: vi.fn() };
  boundary.connect.mockResolvedValue({ client: owner });
  boundary.control.mockResolvedValue(control);
  daemon = new OmnitronDaemon();
  // External I/O is stubbed; startup ordering and Titan's real shutdown
  // coordinator remain under test. No signal reaches the test runner itself.
  for (const method of ['initializeRecoveryMonitor', 'registerTransports', 'exposeRpcServices',
    'wireLogPersistence', 'checkCrashRecovery', 'startInfrastructure', 'registerHealthIndicators',
    'configureWatch', 'startHealthMonitorWorker', 'startApps', 'startScheduledTasks',
    'startBackgroundServices', 'wireEventBroadcasting'] as const) {
    vi.spyOn(daemon as any, method).mockResolvedValue(undefined);
  }
});

afterEach(async () => {
  await app.stop();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  await fs.rm(directory, { recursive: true, force: true });
});

function start() {
  return daemon.start({ ...DEFAULT_ECOSYSTEM, apps: [] }, { noInfra: true, noWatch: true }, {
    ...DEFAULT_DAEMON_CONFIG, role: 'slave', pidFile: path.join(directory, 'daemon.pid'),
    socketPath: path.join(directory, 'daemon.sock'),
    executionHost: { enabled: true, directory: path.join(directory, 'owner') },
  });
}

async function expectPreservedOwnerAndCleanController() {
  expect(owner.shutdownOwner).not.toHaveBeenCalled();
  expect(stopManaged).not.toHaveBeenCalled();
  expect(owner.close).toHaveBeenCalledOnce();
  // Project disposal is idempotent: both the daemon and DI own cleanup.
  expect(project.dispose).toHaveBeenCalled();
  await expect(fs.stat(path.join(directory, 'daemon.pid'))).rejects.toMatchObject({ code: 'ENOENT' });
}

it('joins a listener still binding on SIGTERM before closing it and never announces startup', async () => {
  const binding = deferred<typeof control>();
  boundary.control.mockReturnValue(binding.promise);
  const starting = start();
  await vi.waitFor(() => expect(boundary.control).toHaveBeenCalledOnce());
  const stopping = app.shutdown(ShutdownReason.SIGTERM, { signal: 'SIGTERM' });
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(owner.close).not.toHaveBeenCalled();
  expect(project.dispose).not.toHaveBeenCalled();
  binding.resolve(control);
  expect(await starting).toBe(false);
  await stopping;
  expect(control.stop).toHaveBeenCalledOnce();
  expect((daemon as any).wireLogPersistence).not.toHaveBeenCalled();
  expect((daemon as any).startScheduledTasks).not.toHaveBeenCalled();
  expect(logger.info).not.toHaveBeenCalledWith(expect.anything(), 'Omnitron daemon started');
  await expectPreservedOwnerAndCleanController();
});

it('has cleanup registered when SIGINT arrives inside Titan startup', async () => {
  const entered = deferred();
  const boot = deferred();
  app.onStart(async () => { entered.resolve(); await boot.promise; });
  const starting = start();
  await entered.promise;
  const stopping = app.shutdown(ShutdownReason.SIGINT, { signal: 'SIGINT' });
  boot.resolve();
  expect(await starting).toBe(false);
  await stopping;
  expect(boundary.control).not.toHaveBeenCalled();
  expect((daemon as any).startApps).not.toHaveBeenCalled();
  await expectPreservedOwnerAndCleanController();
});

it('does not start a second shutdown coordinator when Titan is stopped directly during boot', async () => {
  const binding = deferred<typeof control>();
  boundary.control.mockReturnValue(binding.promise);
  const starting = start();
  await vi.waitFor(() => expect(boundary.control).toHaveBeenCalledOnce());
  const stopping = app.stop();
  await new Promise<void>(resolve => setImmediate(resolve));
  binding.resolve(control);
  expect(await starting).toBe(false);
  await stopping;
  expect(control.stop).toHaveBeenCalledOnce();
  await expectPreservedOwnerAndCleanController();
});

it('keeps a real boot error observable after shutdown has finished cleaning up', async () => {
  const binding = deferred<typeof control>();
  boundary.control.mockReturnValue(binding.promise);
  const failure = new Error('listener could not bind');
  const starting = start();
  const rejected = expect(starting).rejects.toBe(failure);
  await vi.waitFor(() => expect(boundary.control).toHaveBeenCalledOnce());
  const stopping = app.shutdown(ShutdownReason.SIGTERM);
  binding.reject(failure);
  await rejected;
  await stopping;
  expect(control.stop).not.toHaveBeenCalled();
  await expectPreservedOwnerAndCleanController();
});

it('does not gate normal readiness on fleet monitoring but joins it before shutdown cleanup', async () => {
  const monitor = deferred();
  const stopWorkers = vi.fn();
  vi.mocked((daemon as any).startHealthMonitorWorker).mockImplementation(async () => {
    await monitor.promise;
    (daemon as any).systemWorkerManager = { stopAll: stopWorkers };
  });
  expect(await start()).toBe(true);
  expect(logger.info).toHaveBeenCalledWith(expect.anything(), 'Omnitron daemon started');
  const stopping = app.shutdown(ShutdownReason.Manual);
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(owner.close).not.toHaveBeenCalled();
  monitor.resolve();
  await stopping;
  expect(stopWorkers).toHaveBeenCalledOnce();
  expect(control.stop).toHaveBeenCalledOnce();
  await expectPreservedOwnerAndCleanController();
});

it('does not start another enabled stack or its reconciler after shutdown begins', async () => {
  vi.mocked((daemon as any).startApps).mockRestore();
  vi.spyOn(daemon as any, 'reconcileOrphanContainers').mockResolvedValue(undefined);
  const first = deferred();
  const startStack = vi.fn(async () => { await first.promise; return { type: 'local', status: 'running' }; });
  Object.assign(project, {
    listProjectRegistrations: () => [{ name: 'fixture', enabledStacks: ['one', 'two'] }],
    loadProjectConfig: async () => undefined,
    listStacks: () => [{ name: 'one' }, { name: 'two' }], startStack,
  });
  const starting = start();
  await vi.waitFor(() => expect(startStack).toHaveBeenCalledOnce());
  const stopping = app.shutdown(ShutdownReason.SIGTERM);
  first.resolve();
  expect(await starting).toBe(false);
  await stopping;
  expect(startStack).toHaveBeenCalledOnce();
  expect(project.startEnabledStacksReconciler).not.toHaveBeenCalled();
  await expectPreservedOwnerAndCleanController();
});

it('also joins a health-worker restart already in flight when shutdown begins', async () => {
  expect(await start()).toBe(true);
  const monitor = deferred();
  const stopWorkers = vi.fn();
  const respawn = vi.fn(async () => {
    await monitor.promise;
    (daemon as any).systemWorkerManager = { stopAll: stopWorkers };
  });
  (daemon as any).healthWorkerSpawn = respawn;
  vi.useFakeTimers();
  try {
    (daemon as any).scheduleHealthMonitorRestart(logger);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(respawn).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
  const stopping = app.shutdown(ShutdownReason.Manual);
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(owner.close).not.toHaveBeenCalled();
  monitor.resolve();
  await stopping;
  expect(stopWorkers).toHaveBeenCalledOnce();
  await expectPreservedOwnerAndCleanController();
});
