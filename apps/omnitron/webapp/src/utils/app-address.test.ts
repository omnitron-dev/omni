/**
 * An app list that showed one stack of two, and a detail page that asked for
 * an app no daemon has.
 *
 * Measured on the master 2026-09-23 with project `daos`, all stacks selected:
 * /apps listed six rows for twelve deployments (dev's, never test's), and
 * /apps/main answered «App with id daos/main not found» — four 404s a poll —
 * because the page prepended `daos/` to the name, which is a handle of
 * nothing.
 */

import { describe, it, expect } from 'vitest';

import type { IProjectAppStatus } from '@omnitron-dev/omnitron/dto/services';

import { countedApps, daemonNameFor, deploymentsIn, detailHref, isLocal, tally } from './app-address';

const deployment = (stack: string, stackType: IProjectAppStatus['stackType'], name: string, handleKey: string) =>
  ({
    name,
    handleKey,
    stack,
    stackType,
    status: 'online',
    pid: 1,
    instances: 1,
    uptime: 1,
    restarts: 0,
    cpu: 0,
    memory: 0,
    port: null,
  }) satisfies IProjectAppStatus;

const devMain = deployment('dev', 'local', 'main', 'daos/dev/main');
const testMain = deployment('test', 'remote', 'main', 'daos/deployed/main');

describe('an app list that showed one stack of two', () => {
  it('lists every deployment with all stacks selected, and one stack’s with one', () => {
    expect(deploymentsIn([devMain, testMain], null)).toEqual([devMain, testMain]);
    expect(deploymentsIn([devMain, testMain], 'test')).toEqual([testMain]);
  });

  it('links a local deployment by its handle, and a remote one nowhere the daemon cannot answer', () => {
    expect(detailHref(devMain)).toBe('/apps/daos%2Fdev%2Fmain');
    expect(isLocal(devMain)).toBe(true);
    expect(isLocal(testMain)).toBe(false);
  });
});

describe('a detail page that asked for an app no daemon has', () => {
  it('asks for a handle as it is, whatever is selected', () => {
    expect(daemonNameFor('daos/dev/main', 'daos', null)).toBe('daos/dev/main');
    expect(daemonNameFor('daos/dev/main', 'daos', 'test')).toBe('daos/dev/main');
  });

  it('qualifies a bare name with the selected stack', () => {
    expect(daemonNameFor('main', 'daos', 'dev')).toBe('daos/dev/main');
  });

  it('leaves a bare name bare with all stacks selected — never project/name', () => {
    expect(daemonNameFor('main', 'daos', null)).toBe('main');
  });
});

describe('a status bar that counted another stack’s apps', () => {
  const localSix = { apps: Array.from({ length: 6 }, () => ({ status: 'online' })) };
  const testDown = { ...testMain, status: 'stopped' as const };
  const asked = (value: IProjectAppStatus[]) => ({ status: 'fulfilled', value }) as const;

  it('counts the selected stack’s deployments, not this daemon’s processes', () => {
    // Beside «daos / test» the bar read 6/6 — dev's six, online — while
    // test's ran on a node it never asked.
    expect(tally(countedApps('daos', 'test', localSix, asked([devMain, testDown]))!)).toEqual({
      appsOnline: 0,
      appsTotal: 1,
    });
    expect(tally(countedApps('daos', null, localSix, asked([devMain, testDown]))!)).toEqual({
      appsOnline: 1,
      appsTotal: 2,
    });
  });

  it('counts this daemon’s own apps with no project selected', () => {
    expect(tally(countedApps(null, null, localSix, { status: 'fulfilled', value: null })!)).toEqual({
      appsOnline: 6,
      appsTotal: 6,
    });
  });

  it('has no count when the selection could not be asked, rather than a zero', () => {
    expect(countedApps('daos', 'test', localSix, { status: 'rejected', reason: new Error('mesh') })).toBeNull();
  });
});
