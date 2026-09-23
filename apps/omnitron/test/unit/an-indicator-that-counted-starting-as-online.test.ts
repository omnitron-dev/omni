/**
 * An indicator that counted «starting» as online, and a health report that
 * exited 0 whatever it said.
 *
 * The daemon's `apps` indicator judged only online and crashed; starting,
 * stopping and stopped fell through to «All N apps online» with N the
 * total — seen right after a daemon restart as «All 3 apps online» while
 * three were still starting. And `omnitron health` exited 0 when the report
 * was degraded or unhealthy, so `omnitron health && …` in a script was told
 * «fine» by the one thing a script reads.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AppHealthIndicator } from '../../src/monitoring/app-health.indicator.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = (name: string, status: string, critical = false) => ({ name, status, critical, restarts: 0 });
const indicatorFor = (apps: ReturnType<typeof app>[]) => new AppHealthIndicator({ list: () => apps } as never);

describe('the apps indicator', () => {
  it('does not call a starting app online', async () => {
    const out = await indicatorFor([app('main', 'online'), app('geo', 'starting'), app('paysys', 'starting')]).check();
    expect(out.status).toBe('degraded');
    expect(out.message).toMatch(/1 of 3 apps online/);
    expect(out.message).toMatch(/starting: geo, paysys/);
  });

  it('still says all online when they are', async () => {
    const out = await indicatorFor([app('main', 'online'), app('geo', 'online')]).check();
    expect(out.status).toBe('healthy');
    expect(out.message).toBe('All 2 apps online');
  });

  it('keeps a crashed critical app unhealthy', async () => {
    const out = await indicatorFor([app('main', 'crashed', true), app('geo', 'starting')]).check();
    expect(out.status).toBe('unhealthy');
  });
});

describe('omnitron health', () => {
  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it('exits non-zero when the report is not healthy', () => {
    const source = fs.readFileSync(path.join(here, '../../src/commands/health.ts'), 'utf8');
    // Before the JSON branch, so both modes carry it.
    const setExit = source.indexOf("if (health.overall !== 'healthy') process.exitCode = 1;");
    const json = source.indexOf('if (emitJson(');
    expect(setExit).toBeGreaterThan(-1);
    expect(setExit).toBeLessThan(json);
  });
});
