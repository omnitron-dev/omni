/**
 * A migration that spoke to nobody — on the node.
 *
 * omni 7515b0c8 made a local stack's migrations say what they did
 * (`Migration said`), and the next deployment showed the other half: a node's
 * migrations run through `RemoteDeployer.migrateNodeApps`, which ran
 * `node dist/database/migrate.js` over SSH, logged «Database migrations
 * applied on the node» and threw the rest away. daos 195 ran on daos/test at
 * 21:20:16 UTC on 2026-09-25 — five measurement axes, twenty-three presets —
 * and the master's log held one line per app and none of the migration's own.
 *
 * The real `deployToStack` and `migrateNodeApps`, over a node whose answers
 * are scripted: its migrator prints what daos's runner and 195 print.
 */

import { describe, it, expect, vi } from 'vitest';

import { RemoteDeployer } from '../../src/services/remote-deployer.service.js';

const TARGET = { host: '37.27.130.185', daemonPort: 9700, username: 'root' } as never;
const NODE = '37.27.130.185:9700';
const MIGRATOR_SAID = [
  'Connecting to PostgreSQL at 127.0.0.1:5432/main',
  'Discovered 203 migration(s): 001_initial_schema, 002_security_role, 195_a_marketplace_that_could_price_nothing',
  '  195: measurement axes — found 0, created 5; presets added 23 (mass 5, volume 3, count 4, length 4, time 7)',
  '  195: other measurement axes in scope product: 0',
  '1 migration(s) applied. 202 already applied.',
  'Done',
].join('\n');

function deployment() {
  const said: Array<{ msg: string; fields: Record<string, unknown> }> = [];
  const info = (fields: Record<string, unknown>, msg: string) => said.push({ fields, msg });
  const svc: any = Object.create(RemoteDeployer.prototype);
  Object.assign(svc, {
    logger: { info, warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    emitProgress: vi.fn(),
    execution: {
      ssh: async (_t: unknown, cmd: string) => {
        if (cmd.startsWith('test -f')) return { stdout: 'yes', stderr: '', exitCode: 0, duration: 1 };
        if (cmd.includes('migrate.js')) return { stdout: `${MIGRATOR_SAID}\n`, stderr: '', exitCode: 0, duration: 1 };
        return { stdout: '', stderr: '', exitCode: 0, duration: 1 };
      },
    },
    deployToNode: async (_t: unknown, artifact: { app: string; version: string }) => ({
      app: artifact.app,
      version: artifact.version,
      node: NODE,
      status: 'success',
      unchanged: false,
    }),
    registerNodeApps: async () => ({ changed: true }),
    openGatewayPath: async () => {},
    appsOnline: async () => new Set(['main']),
    signalRemoteDaemon: async () => ({ ok: true, detail: '' }),
    verifyHealth: async () => ({ online: true, detail: '' }),
  });
  const run = () =>
    svc.deployToStack([TARGET], [{ app: 'main', version: '0.0.1' }], 'daos', {
      apps: [{ name: 'main', script: 'apps/main/dist/main.js' }],
      appEnv: { main: { DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/main' } },
      stack: 'test',
    });
  return { run, said };
}

describe('a migration that spoke to nobody — on the node', () => {
  it("logs what the node's migrator said, in order, before the verdict", async () => {
    const { run, said } = deployment();

    await run();

    const lines = said.filter((s) => s.msg === 'Migration said');
    expect(lines.map((s) => s.fields['line'])).toEqual([
      'Connecting to PostgreSQL at 127.0.0.1:5432/main',
      'Discovered 203 migration(s)',
      '  195: measurement axes — found 0, created 5; presets added 23 (mass 5, volume 3, count 4, length 4, time 7)',
      '  195: other measurement axes in scope product: 0',
      '1 migration(s) applied. 202 already applied.',
      'Done',
    ]);
    expect(lines.every((s) => s.fields['app'] === 'main' && s.fields['node'] === '37.27.130.185')).toBe(true);
    const verdict = said.findIndex((s) => s.msg === 'Database migrations applied on the node');
    expect(verdict).toBeGreaterThan(said.lastIndexOf(lines.at(-1)!));
  });
});
