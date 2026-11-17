import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const runtime = vi.hoisted(() => ({ home: '', running: true, start: vi.fn(), localStart: vi.fn(), stop: vi.fn(),
  service: vi.fn(), disconnect: vi.fn(), connect: vi.fn(), error: vi.fn(), info: vi.fn() }));
// The command must remain usable while daemon/process-host dependencies are being upgraded.
vi.mock('../../src/commands/up.js', () => {
  throw new Error('Startup unavailable during upgrade');
});
vi.mock('../../src/daemon/daemon.js', () => {
  throw new Error('Daemon implementation must not load');
});
vi.mock('../../src/daemon/daemon-client.js', () => ({ createDaemonClient: runtime.connect }));
vi.mock('../../src/config/defaults.js', () => ({
  OMNITRON_HOME: runtime.home,
  DEFAULT_DAEMON_CONFIG: { pidFile: '/fixture/daemon.pid' },
}));
vi.mock('../../src/daemon/pid-manager.js', () => ({
  PidManager: class {
    isRunning() {
      return runtime.running;
    }
  },
}));
vi.mock('../../src/webapp/webapp.service.js', () => ({
  WebappService: class {
    start = runtime.localStart;
    stop = runtime.stop;
    status = async () => ({ running: true, healthy: true, port: 9800 });
  },
}));
vi.mock('@xec-sh/kit', () => ({ log: { info: runtime.info, warn: vi.fn(), error: runtime.error }, prism: {} }));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  runtime.running = true;
  runtime.home = fs.mkdtempSync(path.join(os.tmpdir(), 'console-config-'));
  runtime.start.mockResolvedValue({ running: true, healthy: true, port: 19800, url: 'http://127.0.0.1:19800', autoStart: true });
  runtime.stop.mockResolvedValue(false);
  runtime.service.mockResolvedValue({ startConsole: runtime.start });
  runtime.connect.mockReturnValue({ service: runtime.service, disconnect: runtime.disconnect });
  fs.writeFileSync(
    path.join(runtime.home, 'config.json'),
    JSON.stringify({
      role: 'master',
      initialized: true,
      initializedAt: '2026-10-31',
      webapp: false,
      files: { enabled: false },
      auth: { jwtSecret: 'test-fixture' },
    }),
    { mode: 0o600 }
  );
});
afterEach(() => {
  fs.rmSync(runtime.home, { recursive: true, force: true });
  process.exitCode = 0;
});
it('routes publication to the serving daemon without importing startup or writing its policy', async () => {
  const { webappStartCommand } = await import('../../src/commands/webapp.js');
  const file = path.join(runtime.home, 'config.json');
  const before = fs.readFileSync(file);
  await webappStartCommand();
  expect(runtime.service).toHaveBeenCalledWith('OmnitronBackend');
  expect(runtime.start).toHaveBeenCalledOnce();
  expect(runtime.localStart).not.toHaveBeenCalled();
  expect(runtime.disconnect).toHaveBeenCalledOnce();
  expect(runtime.info).toHaveBeenCalledWith('Omnitron Console: http://127.0.0.1:19800');
  expect(fs.readFileSync(file)).toEqual(before);
  expect(runtime.error).not.toHaveBeenCalled();
});
it('stops through the independent lifecycle service when no backend is running', async () => {
  runtime.running = false;
  const { webappStopCommand } = await import('../../src/commands/webapp.js');
  const file = path.join(runtime.home, 'config.json');
  const before = fs.readFileSync(file);
  await webappStopCommand();
  expect(runtime.stop).toHaveBeenCalledOnce();
  expect(runtime.connect).not.toHaveBeenCalled();
  expect(fs.readFileSync(file)).toEqual(before);
  expect(runtime.error).not.toHaveBeenCalled();
});
it('reports a remote failure without substituting a local start or changing settings', async () => {
  runtime.start.mockRejectedValueOnce(new Error('Nginx health check failed'));
  const { webappStartCommand } = await import('../../src/commands/webapp.js');
  await webappStartCommand();
  expect(runtime.error).toHaveBeenCalledWith('Nginx health check failed');
  expect(process.exitCode).toBe(1);
  expect(runtime.localStart).not.toHaveBeenCalled();
  expect(runtime.disconnect).toHaveBeenCalledOnce();
  expect(JSON.parse(fs.readFileSync(path.join(runtime.home, 'config.json'), 'utf8')).webapp).toBe(false);
});
