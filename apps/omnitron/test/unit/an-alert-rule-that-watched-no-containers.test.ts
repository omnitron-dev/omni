/**
 * An alert rule that watched no containers.
 *
 * `AlertService` read the containers through an accessor token wired to
 * `() => ({})`. The console's rule form accepts `infra.<name>.health !=
 * healthy` as a supported expression — and the evaluator ran it against no
 * containers at all, every fifteen seconds, for ever: a postgres that died
 * could not fire it.
 *
 * It now reads every container of every stack on this machine, and a
 * container without a healthcheck reads `healthy` while it runs, so
 * `infra.*.health != healthy` does not fire for ever on tor.
 */

import { describe, it, expect, vi } from 'vitest';

import { AlertService, containerHealth } from '../../src/services/alert.service.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

const container = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  image: 'x',
  status: 'running',
  health: 'none',
  ...over,
});

const projectsWith = (stacks: Record<string, Record<string, unknown>>) => ({
  getInfraManager: () => ({
    listInstances: () =>
      Object.entries(stacks).map(([key, services]) => ({
        project: key.split('/')[0],
        stack: key.split('/')[1],
        infra: { getState: () => ({ services, ready: true }) },
      })),
  }),
});

/** A database with one enabled rule, recording what the evaluation wrote. */
function dbWithRule(expression: string) {
  const inserted: Array<Record<string, unknown>> = [];
  const chain: any = {
    selectAll: () => chain,
    where: () => chain,
    set: () => chain,
    values: (v: Record<string, unknown>) => {
      inserted.push(v);
      return chain;
    },
    execute: async () => [{ id: 'r1', name: 'infra', expression, enabled: true }],
    executeTakeFirst: async () => undefined,
  };
  return { db: { selectFrom: () => chain, updateTable: () => chain, insertInto: () => chain }, inserted };
}

const evaluate = async (expression: string, stacks: Record<string, Record<string, unknown>>) => {
  const { db, inserted } = dbWithRule(expression);
  const svc = new AlertService({ logger } as never, db as never, { list: () => [] } as never, projectsWith(stacks) as never);
  await svc.evaluate();
  return inserted.filter((row) => row['status'] === 'firing');
};

describe('an infra rule is evaluated against the stacks\' containers', () => {
  it('fires when a container of a stack on this machine stops', async () => {
    const fired = await evaluate('infra.postgres.health != healthy', {
      'daos/dev': { 'daos-dev-postgres': container('daos-dev-postgres', { status: 'exited' }) },
    });

    expect(fired).toHaveLength(1);
    expect(fired[0]!['value']).toBe('daos-dev-postgres=stopped');
  });

  it('does not fire on a running container that declares no healthcheck', async () => {
    const fired = await evaluate('infra.*.health != healthy', {
      'daos/dev': { 'daos-dev-tor': container('daos-dev-tor'), 'daos-dev-redis': container('daos-dev-redis', { health: 'healthy' }) },
    });

    expect(fired).toEqual([]);
  });

  it('reads every stack, not the first', async () => {
    const fired = await evaluate('infra.*.health != healthy', {
      'daos/dev': { 'daos-dev-redis': container('daos-dev-redis') },
      'acme/dev': { 'acme-dev-minio': container('acme-dev-minio', { health: 'unhealthy' }) },
    });

    expect(fired[0]!['value']).toBe('acme-dev-minio=unhealthy');
  });
});

describe('a container\'s health, in the words a rule compares', () => {
  it('maps what docker says to healthy, starting, unhealthy or stopped', () => {
    expect(containerHealth({ status: 'running', health: 'none' })).toBe('healthy');
    expect(containerHealth({ status: 'running', health: 'starting' })).toBe('starting');
    expect(containerHealth({ status: 'running', health: 'unhealthy' })).toBe('unhealthy');
    expect(containerHealth({ status: 'running', health: 'healthy', networkAttached: false })).toBe('unhealthy');
    expect(containerHealth({ status: 'restarting', health: 'healthy' })).toBe('stopped');
  });
});
