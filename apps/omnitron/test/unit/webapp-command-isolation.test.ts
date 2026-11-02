import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const runtime = vi.hoisted(() => ({ home: '', start: vi.fn(), stop: vi.fn(), error: vi.fn() }));
// The command must remain usable while daemon/process-host dependencies are being upgraded.
vi.mock('../../src/commands/up.js', () => {
  throw new Error('Startup unavailable during upgrade');
});
vi.mock('../../src/daemon/daemon.js', () => {
  throw new Error('Daemon implementation must not load');
});
vi.mock('../../src/config/defaults.js', () => ({
  OMNITRON_HOME: runtime.home,
  DEFAULT_DAEMON_CONFIG: { pidFile: '/fixture/daemon.pid' },
}));
vi.mock('../../src/daemon/pid-manager.js', () => ({
  PidManager: class {
    isRunning() {
      return true;
    }
  },
}));
vi.mock('../../src/webapp/webapp.service.js', () => ({
  WebappService: class {
    start = runtime.start;
    stop = runtime.stop;
    status = async () => ({ running: true, healthy: true, port: 9800 });
  },
}));
vi.mock('@xec-sh/kit', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: runtime.error }, prism: {} }));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  runtime.home = fs.mkdtempSync(path.join(os.tmpdir(), 'console-config-'));
  runtime.start.mockResolvedValue(undefined);
  runtime.stop.mockResolvedValue(undefined);
  fs.writeFileSync(
    path.join(runtime.home, 'config.json'),
    JSON.stringify({
      role: 'master',
      initialized: true,
      initializedAt: '2026-10-31',
      webapp: false,
      files: { enabled: false },
      auth: { jwtSecret: 'test-fixture' },
    })
  );
});
afterEach(() => {
  fs.rmSync(runtime.home, { recursive: true, force: true });
  process.exitCode = 0;
});
it('starts and stops Console without loading daemon startup or losing saved policy', async () => {
  const { webappStartCommand, webappStopCommand } = await import('../../src/commands/webapp.js');
  await webappStartCommand();
  const file = path.join(runtime.home, 'config.json');
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({
    webapp: true,
    files: { enabled: false },
    auth: { jwtSecret: 'test-fixture' },
  });
  expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  await webappStopCommand();
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).webapp).toBe(false);
  expect(runtime.error).not.toHaveBeenCalled();
});
it('reports a failed start with a failing exit status and does not enable autostart', async () => {
  runtime.start.mockRejectedValueOnce(new Error('Nginx health check failed'));
  const { webappStartCommand } = await import('../../src/commands/webapp.js');
  await webappStartCommand();
  expect(runtime.error).toHaveBeenCalledWith('Nginx health check failed');
  expect(process.exitCode).toBe(1);
  expect(JSON.parse(fs.readFileSync(path.join(runtime.home, 'config.json'), 'utf8')).webapp).toBe(false);
});
