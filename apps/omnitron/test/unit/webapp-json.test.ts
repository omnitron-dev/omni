import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache, setEnvOverride } from '../../src/shared/env-config.js';
const runtime = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  status: vi.fn(),
  build: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  browser: vi.fn(),
  running: true,
  logger: null as any,
  logs: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock('@xec-sh/kit', () => ({ log: runtime.logs, prism: {} }));
vi.mock('../../src/webapp/webapp.service.js', () => ({
  WebappService: class {
    constructor(logger: unknown) {
      runtime.logger = logger;
    }
    start = runtime.start;
    stop = runtime.stop;
    status = runtime.status;
    build = runtime.build;
  },
}));
vi.mock('../../src/daemon/pid-manager.js', () => ({
  PidManager: class {
    isRunning() {
      return runtime.running;
    }
  },
}));
vi.mock('../../src/config/saved.js', () => ({
  readSavedDaemonConfig: runtime.read,
  writeSavedDaemonConfig: runtime.write,
}));
vi.mock('node:child_process', () => ({ execFile: runtime.browser }));
import {
  webappBuildCommand,
  webappStartCommand,
  webappStopCommand,
  webappStatusCommand,
  webappOpenCommand,
} from '../../src/commands/webapp.js';
let out: string[], err: string[];
beforeEach(() => {
  vi.resetAllMocks();
  process.exitCode = undefined;
  setEnvOverride({ OMNITRON_OUTPUT: 'json' });
  runtime.running = true;
  runtime.read.mockReturnValue({ initialized: true, role: 'master', webapp: false, files: { enabled: false } });
  runtime.status.mockResolvedValue({ running: true, healthy: true, port: 9800 });
  runtime.start.mockImplementation(async () => {
    runtime.logger.info('progress');
    runtime.logger.warn('progress warning');
  });
  runtime.build.mockResolvedValue({ distPath: '/fixture/dist', duration: 1200 });
  runtime.browser.mockImplementation((_command, _args, _options, callback) => callback(null, '', ''));
  out = [];
  err = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    err.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  resetEnvCache();
  process.exitCode = undefined;
});
const success = () => {
  expect(err).toEqual([]);
  expect(Object.values(runtime.logs).every((log) => log.mock.calls.length === 0)).toBe(true);
  return JSON.parse(out.join(''));
};
const failure = () => {
  expect(out).toEqual([]);
  expect(process.exitCode).toBe(1);
  return JSON.parse(err.join(''));
};
describe('Console lifecycle machine protocol', () => {
  it('reports one result after start and persistence, suppressing service progress', async () => {
    await webappStartCommand({ force: true });
    expect(runtime.start).toHaveBeenCalledWith({ force: true });
    expect(runtime.write).toHaveBeenCalledWith(expect.objectContaining({ webapp: true, files: { enabled: false } }));
    expect(success()).toEqual({
      ok: true,
      data: {
        operation: 'start',
        running: true,
        healthy: true,
        port: 9800,
        url: 'http://localhost:9800',
        autoStart: true,
      },
    });
  });
  it('reports daemon absence before any container mutation', async () => {
    runtime.running = false;
    await webappStartCommand();
    expect(runtime.start).not.toHaveBeenCalled();
    expect(runtime.write).not.toHaveBeenCalled();
    expect(failure()).toMatchObject({ ok: false, code: 'DAEMON_NOT_RUNNING', outcome: 'not-started' });
  });
  it('retains partial-operation uncertainty when container start fails', async () => {
    runtime.start.mockRejectedValue(new Error('Container readiness timed out'));
    await webappStartCommand();
    expect(runtime.write).not.toHaveBeenCalled();
    expect(failure()).toMatchObject({ ok: false, operation: 'start', outcome: 'unknown' });
  });
  it('does not claim start was undone when saving its preference fails', async () => {
    runtime.write.mockImplementation(() => {
      throw Error('Disk unavailable');
    });
    await webappStartCommand();
    expect(runtime.start).toHaveBeenCalledOnce();
    expect(failure()).toMatchObject({ ok: false, operation: 'start', outcome: 'applied' });
  });
  it('reports stop and preserves unrelated saved policy', async () => {
    runtime.read.mockReturnValue({ webapp: true, files: { enabled: false } });
    await webappStopCommand();
    expect(runtime.stop).toHaveBeenCalledOnce();
    expect(runtime.write).toHaveBeenCalledWith({ webapp: false, files: { enabled: false } });
    expect(success()).toMatchObject({ ok: true, data: { operation: 'stop', stopped: true, autoStart: false } });
  });
  it('reports stop failure without disabling startup policy', async () => {
    runtime.stop.mockRejectedValue(new Error('Docker unavailable'));
    await webappStopCommand();
    expect(runtime.write).not.toHaveBeenCalled();
    expect(failure()).toMatchObject({ operation: 'stop', outcome: 'unknown' });
  });
  it('reports build duration and published path', async () => {
    await webappBuildCommand();
    expect(success()).toEqual({ ok: true, data: { operation: 'build', distPath: '/fixture/dist', durationMs: 1200 } });
  });
  it('reports stopped status as data, not a failed operation', async () => {
    runtime.status.mockResolvedValue({ running: false, healthy: false, port: 9800 });
    await webappStatusCommand();
    expect(success()).toMatchObject({ ok: true, data: { running: false, healthy: false } });
    expect(process.exitCode).toBeUndefined();
  });
  it('waits for the browser launcher and reports the explicit open action', async () => {
    await webappOpenCommand();
    expect(runtime.browser).toHaveBeenCalledOnce();
    expect(success()).toMatchObject({ ok: true, data: { operation: 'open', browserOpened: true, started: false } });
  });
  it('reports browser-launch failure after a successful Console start truthfully', async () => {
    runtime.status.mockResolvedValueOnce({ running: false, healthy: false, port: 9800 });
    runtime.browser.mockImplementation((_command, _args, _options, callback) =>
      callback(new Error('No browser handler'))
    );
    await webappOpenCommand();
    expect(runtime.start).toHaveBeenCalledOnce();
    expect(failure()).toMatchObject({ operation: 'open', outcome: 'applied' });
  });
});
