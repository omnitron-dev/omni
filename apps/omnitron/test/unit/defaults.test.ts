import { describe, it, expect } from 'vitest';
import {
  OMNITRON_HOME,
  CLI_VERSION,
  DAEMON_SERVICE_ID,
  DEFAULT_PORTS,
  DEFAULT_ECOSYSTEM,
} from '../../src/config/defaults.js';
import os from 'node:os';
import path from 'node:path';

describe('Defaults', () => {
  it('OMNITRON_HOME is in user home directory', () => {
    expect(OMNITRON_HOME).toBe(path.join(os.homedir(), '.omnitron'));
  });

  it('CLI_VERSION is a semver string', () => {
    expect(CLI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('DAEMON_SERVICE_ID has correct format', () => {
    expect(DAEMON_SERVICE_ID).toBe('OmnitronDaemon@1.0.0');
  });

  it('DEFAULT_PORTS covers all 5 apps', () => {
    expect(DEFAULT_PORTS['main']).toBe(3001);
    expect(DEFAULT_PORTS['storage']).toBe(3002);
    expect(DEFAULT_PORTS['priceverse']).toBe(3003);
    expect(DEFAULT_PORTS['paysys']).toBe(3004);
    expect(DEFAULT_PORTS['messaging']).toBe(3005);
  });

  it('DEFAULT_ECOSYSTEM has correct supervision defaults', () => {
    expect(DEFAULT_ECOSYSTEM.supervision.strategy).toBe('one_for_one');
    expect(DEFAULT_ECOSYSTEM.supervision.maxRestarts).toBe(5);
    expect(DEFAULT_ECOSYSTEM.supervision.window).toBe(60_000);
    expect(DEFAULT_ECOSYSTEM.supervision.backoff.type).toBe('exponential');
    expect(DEFAULT_ECOSYSTEM.supervision.backoff.initial).toBe(1_000);
    expect(DEFAULT_ECOSYSTEM.supervision.backoff.max).toBe(30_000);
    expect(DEFAULT_ECOSYSTEM.supervision.backoff.factor).toBe(2);
  });

  it('DEFAULT_ECOSYSTEM has correct monitoring defaults', () => {
    expect(DEFAULT_ECOSYSTEM.monitoring.healthCheck.interval).toBe(15_000);
    expect(DEFAULT_ECOSYSTEM.monitoring.healthCheck.timeout).toBe(5_000);
    expect(DEFAULT_ECOSYSTEM.monitoring.metrics.interval).toBe(5_000);
    expect(DEFAULT_ECOSYSTEM.monitoring.metrics.retention).toBe(3600);
  });

  it('DEFAULT_ECOSYSTEM has correct logging defaults', () => {
    expect(DEFAULT_ECOSYSTEM.logging.maxSize).toBe('50mb');
    expect(DEFAULT_ECOSYSTEM.logging.maxFiles).toBe(10);
    expect(DEFAULT_ECOSYSTEM.logging.compress).toBe(true);
    expect(DEFAULT_ECOSYSTEM.logging.format).toBe('json');
  });

  it('DEFAULT_ECOSYSTEM has correct daemon defaults', () => {
    expect(DEFAULT_ECOSYSTEM.daemon.port).toBe(9700);
    expect(DEFAULT_ECOSYSTEM.daemon.host).toBe('127.0.0.1');
    expect(DEFAULT_ECOSYSTEM.daemon.pidFile).toContain('.omnitron');
    expect(DEFAULT_ECOSYSTEM.daemon.stateFile).toContain('.omnitron');
  });

  it('DEFAULT_ECOSYSTEM env is development', () => {
    expect(DEFAULT_ECOSYSTEM.env).toBe('development');
  });
});
