import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache, setEnvOverride } from '../../src/shared/env-config.js';
const runtime = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  status: vi.fn(),
  build: vi.fn(),
  disconnect: vi.fn(),
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
vi.mock('../../src/daemon/daemon-client.js', () => ({
  createDaemonClient: () => ({ service: async () => ({ startConsole: runtime.start }), disconnect: runtime.disconnect }),
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
  const status = { running: true, healthy: true, port: 19800, url: 'http://127.0.0.1:19800' };
  runtime.status.mockResolvedValue(status);
  runtime.start.mockResolvedValue({ ...status, autoStart: true });
  runtime.stop.mockResolvedValue(false);
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
  it('reports the serving daemon receipt and its configured port', async () => {
    await webappStartCommand({ force: true });
    expect(runtime.start).toHaveBeenCalledWith({ force: true });
    expect(runtime.disconnect).toHaveBeenCalledOnce();
    expect(success()).toEqual({
      ok: true,
      data: {
        operation: 'start',
        running: true,
        healthy: true,
        port: 19800,
        url: 'http://127.0.0.1:19800',
        autoStart: true,
      },
    });
  });
  it('reports daemon absence before any container mutation', async () => {
    runtime.running = false;
    await webappStartCommand();
    expect(runtime.start).not.toHaveBeenCalled();
    expect(runtime.disconnect).not.toHaveBeenCalled();
    expect(failure()).toMatchObject({ ok: false, code: 'DAEMON_NOT_RUNNING', outcome: 'not-started' });
  });
  it('retains partial-operation uncertainty when container start fails', async () => {
    runtime.start.mockRejectedValue(new Error('Container readiness timed out'));
    await webappStartCommand();
    expect(runtime.disconnect).toHaveBeenCalledOnce();
    expect(failure()).toMatchObject({ ok: false, operation: 'start', outcome: 'unknown' });
  });
  it('does not repeat the mutation when a daemon acknowledgement is lost', async () => {
    runtime.start.mockRejectedValue(Error('Acknowledgement lost'));
    await webappStartCommand();
    expect(runtime.start).toHaveBeenCalledOnce();
    expect(failure()).toMatchObject({ ok: false, operation: 'start', outcome: 'unknown' });
  });
  it('can stop through the instance service when the daemon is down', async () => {
    runtime.running = false;
    await webappStopCommand();
    expect(runtime.stop).toHaveBeenCalledOnce();
    expect(runtime.disconnect).not.toHaveBeenCalled();
    expect(success()).toMatchObject({ ok: true, data: { operation: 'stop', stopped: true, autoStart: false } });
  });
  it('reports stop failure without claiming a native receipt', async () => {
    runtime.stop.mockRejectedValue(new Error('Docker unavailable'));
    await webappStopCommand();
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
    expect(runtime.start).toHaveBeenCalledWith({ temporary: true });
    expect(failure()).toMatchObject({ operation: 'open', outcome: 'applied' });
  });
});
