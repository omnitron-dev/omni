import { describe, it, expect } from 'vitest';
import {
  OMNITRON_HOME,
  CLI_VERSION,
  DAEMON_SERVICE_ID,
  DEFAULT_PORTS,
  DEFAULT_ECOSYSTEM,
  DEFAULT_DAEMON_CONFIG,
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
    // Service naming carries no version suffix (project decision: unversioned Titan service ids).
    expect(DAEMON_SERVICE_ID).toBe('OmnitronDaemon');
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
    // `format` was removed from the ecosystem logging shape; `level` replaced it.
    expect(DEFAULT_ECOSYSTEM.logging.level).toBe('info');
  });

  it('DEFAULT_DAEMON_CONFIG has correct daemon defaults', () => {
    // Daemon settings moved out of the project ecosystem config into the
    // dedicated DEFAULT_DAEMON_CONFIG (the daemon manages its own paths/ports).
    expect(DEFAULT_DAEMON_CONFIG.port).toBe(9700);
    // Daemon binds all interfaces by design (slave nodes / nginx reach it).
    expect(DEFAULT_DAEMON_CONFIG.host).toBe('0.0.0.0');
    expect(DEFAULT_DAEMON_CONFIG.pidFile).toContain('.omnitron');
    expect(DEFAULT_DAEMON_CONFIG.stateFile).toContain('.omnitron');
  });
});
