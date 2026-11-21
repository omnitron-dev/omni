/**
 * An alarm the node had nowhere to send.
 *
 * Release 6 put the alert engine on the test node (c3502c1b) and omni-3f
 * proved it live: a probe rule fired and resolved in the node's SQLite. It
 * was delivered nowhere — nine ticks for the firing, nine for its end,
 * `deliveredAt` and `deliveryError` both empty, 0 `opsAlert` in main. The
 * node does not read the project's `omnitron.config.ts`: the master renders
 * it a config (`renderNodeAppConfig`) with the apps and one stack, and
 * `monitoring.alertSink` was not in it. With no sink the engine returned
 * before it looked at a single event, so nothing said the alarms went nowhere.
 *
 * Now the deployment writes the sink into the node's config, named the way
 * the master names the stack (`sample/test`, not the node's own `deployed`),
 * and a daemon with no sink says so on each undelivered critical event.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql, type Kysely } from 'kysely';

import { renderNodeAppConfig } from '../../src/project/node-app-config.js';
import { loadEcosystemConfig } from '../../src/config/loader.js';
import { SlaveStorageService } from '../../src/services/slave-storage.service.js';
import { AlertService, NO_SINK } from '../../src/services/alert.service.js';

vi.mock('../../src/monitoring/host-disk.js', () => ({
  diskAtHome: async () => ({ free: 390 * 1024 ** 3, total: 905 * 1024 ** 3 }),
}));

const logger = { debug() {}, info() {}, warn() {}, error() {}, trace() {}, fatal() {}, child: () => logger };
const SINK = { app: 'main', service: 'OpsAlerts', method: 'raise', host: 'sample/test' };

describe('the node’s config carries the sink', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'omnitron-node-config-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const render = (alertSink?: typeof SINK) =>
    renderNodeAppConfig({
      project: 'sample',
    sourceStack: 'test',
      artifactRoot: '/opt/omnitron/artifacts',
      apps: [{ name: 'main', bootstrap: './apps/main/src/bootstrap.ts' } as never],
      artifacts: [{ app: 'main', version: '1.0.0' }],
      ...(alertSink && { alertSink }),
    });

  it('as the node’s loader reads it back', async () => {
    writeFileSync(join(dir, 'omnitron.config.mjs'), render(SINK));
    const config = await loadEcosystemConfig(dir);
    expect(config.monitoring.alertSink).toEqual(SINK);
  });

  it('and says nothing of monitoring for a project without one', () => {
    expect(render()).not.toMatch(/monitoring/);
  });

  it('the deployment hands it over, named as the master names the stack', () => {
    const project = readFileSync(new URL('../../src/services/project.service.ts', import.meta.url), 'utf8');
    expect(project).toMatch(/alertSink: \{ \.\.\.sink, host: `\$\{projectName\}\/\$\{stackName\}` \}/);
    const deployer = readFileSync(new URL('../../src/services/remote-deployer.service.ts', import.meta.url), 'utf8');
    expect(deployer).toMatch(/options\.appEnv,\s*options\.alertSink,?/);
    expect(deployer).toMatch(/appEnv,\s*alertSink,\s*\}\);/);
  });
});

describe('the node’s engine, with the sink and without it', () => {
  let dir: string;
  let db: Kysely<any>;
  const raised: Array<Record<string, unknown>> = [];
  const apps = [
    { name: 'sample/deployed/main', status: 'online', cpu: 1, memory: 1 },
    { name: 'sample/deployed/storage', status: 'online', cpu: 1, memory: 1 },
  ];
  const orchestrator = {
    list: () => apps,
    getHandle: (name: string) => {
      const app = apps.find((a) => a.name === name);
      return app && {
        status: app.status,
        mode: 'bootstrap',
        supervisor: {
          getChildNames: () => ['notification-worker'],
          getChildProxy: async () => ({
            getExposedServices: async () => [{ name: 'OpsAlerts', methods: ['raise'] }],
            callExposedService: async (_s: string, _m: string, args: unknown[]) => {
              raised.push(args[0] as Record<string, unknown>);
              return { queued: true };
            },
          }),
        },
      };
    },
  };
  const engine = (sink?: typeof SINK, loadProjectConfig = async () => ({ monitoring: sink ? { alertSink: sink } : {} }),
    listWorkspaceNames = () => ['sample']) =>
    new AlertService({ logger } as never, db, orchestrator as never, {
      listWorkspaceNames, loadProjectConfig,
    } as never);

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'omnitron-node-sink-'));
    db = await new SlaveStorageService(logger as never, join(dir, 'slave.db')).getDb();
  });
  afterAll(async () => {
    await db?.destroy();
    rmSync(dir, { recursive: true, force: true });
  });

  it('leaves project configuration alone when there is no critical event to deliver', async () => {
    const load = vi.fn(async () => ({ monitoring: { alertSink: SINK } }));
    const list = vi.fn(() => ['sample']);
    await engine(SINK, load, list).evaluate();
    expect(await db.selectFrom('alert_events').select('id').execute()).toEqual([]);
    expect(list).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it('with no sink, says so on the event instead of saying nothing', async () => {
    apps[1]!.status = 'crashed';
    await engine().evaluate();

    const [event] = await db.selectFrom('alert_events').selectAll().execute();
    expect(event).toMatchObject({ status: 'firing', deliveredAt: null, deliveryError: NO_SINK });
    expect(raised).toEqual([]);
  });

  it('with the sink, delivers it — as sample/test, the stack the master named', async () => {
    await engine(SINK).evaluate();

    expect(raised).toMatchObject([
      { status: 'firing', ruleName: 'App crashed', host: 'sample/test', value: 'sample/deployed/storage=crashed' },
    ]);
    const [event] = await db.selectFrom('alert_events').selectAll().execute();
    expect(event!['deliveredAt']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(event!['deliveryError']).toBeNull();
    await sql`DELETE FROM alert_events`.execute(db);
  });

  it('completes an accepted sink transition and leaves its next transition for the successor', async () => {
    await sql`DELETE FROM alert_events`.execute(db);
    raised.length = 0;
    apps[1]!.status = 'crashed';
    await engine().evaluate();
    apps[1]!.status = 'online';
    await engine().evaluate();
    const stop = new AbortController();
    const stages: Array<string | undefined> = [];
    const handle = orchestrator.getHandle(apps[0]!.name)!;
    const observer = { ...orchestrator, getHandle: () => ({ ...handle, supervisor: {
      ...handle.supervisor,
      getChildProxy: async () => {
        const proxy = await handle.supervisor.getChildProxy();
        return { ...proxy, callExposedService: async (...args: Parameters<typeof proxy.callExposedService>) => {
          stages.push(source.evaluationStage);
          const reply = await proxy.callExposedService(...args);
          stop.abort();
          return reply;
        } };
      },
    } }) };
    const source = new AlertService({ logger } as never, db, observer as never, {
      listWorkspaceNames: () => ['sample'],
      loadProjectConfig: async () => ({ monitoring: { alertSink: SINK } }),
    } as never);
    await source.evaluate(Date.now(), stop.signal);
    const event = await db.selectFrom('alert_events').selectAll().executeTakeFirstOrThrow();
    expect(stages).toEqual([`delivering firing for ${event['id']}`]);
    expect(source.evaluationStage).toBeUndefined();
    expect(raised.map(value => value['status'])).toEqual(['firing']);
    expect(event['deliveredAt']).toBeTruthy();
    expect(event['resolveDeliveredAt']).toBeNull();
    await engine(SINK).evaluate();
    expect(raised.map(value => [value['eventId'], value['status']])).toEqual([[event['id'], 'firing'], [event['id'], 'resolved']]);
  });

  it('delivers both recorded transitions once after the last enabled rule is disabled', async () => {
    await sql`DELETE FROM alert_events`.execute(db);
    raised.length = 0;
    apps[1]!.status = 'crashed';
    const incumbent = engine();
    await incumbent.evaluate();
    apps[1]!.status = 'online';
    await incumbent.evaluate();
    const event = await db.selectFrom('alert_events').selectAll().executeTakeFirstOrThrow();
    expect(event).toMatchObject({ status: 'resolved', deliveredAt: null, resolveDeliveredAt: null });
    const enabled = await db.selectFrom('alert_rules').select('id').where('enabled', '=', true).execute();
    for (const rule of enabled) await incumbent.updateRule(rule['id'], { enabled: false });
    try {
      const successor = engine(SINK);
      await successor.evaluate();
      await successor.evaluate();
      expect(raised.map(value => [value['eventId'], value['status']])).toEqual([
        [event['id'], 'firing'], [event['id'], 'resolved'],
      ]);
      const receipt = await db.selectFrom('alert_events').selectAll().where('id', '=', event['id']).executeTakeFirstOrThrow();
      expect(receipt['deliveredAt']).toBeTruthy();
      expect(receipt['resolveDeliveredAt']).toBeTruthy();
    } finally {
      for (const rule of enabled) await incumbent.updateRule(rule['id'], { enabled: true });
    }
  });
});
