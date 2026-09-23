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

import type { IProjectAppStatus, ProcessInfoDto, SubProcessInfoDto } from '@omnitron-dev/omnitron/dto/services';

import {
  countedApps,
  countedTraffic,
  daemonNameFor,
  deploymentsIn,
  detailHref,
  isLocal,
  measuredProcess,
  shownApps,
  tally,
} from './app-address';

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

describe('a dashboard that showed one machine of a project', () => {
  // This daemon's own process for dev's main, with the process list only it has.
  const devProcess = {
    name: 'daos/dev/main',
    pid: 1,
    status: 'online',
    cpu: 0,
    memory: 0,
    uptime: 1,
    restarts: 0,
    instances: 1,
    port: null,
    mode: 'bootstrap',
    critical: false,
    processes: [],
  } satisfies ProcessInfoDto;

  it('shows the project’s deployments on every machine, each keyed and grouped by its stack', () => {
    const shown = shownApps('daos', null, [devMain, testMain], [devProcess])!;

    expect(shown.map((a) => [a.key, a.name, a.stack, a.remote])).toEqual([
      ['daos/dev/main', 'main', 'dev', false],
      ['test/main', 'main', 'test', true],
    ]);
    expect(shown[0]!.processes, 'a local app keeps what this daemon knows of it').toEqual([]);
    expect(shown[1]!.processes).toBeUndefined();
  });

  it('shows one stack’s deployments when one is selected', () => {
    expect(shownApps('daos', 'test', [devMain, testMain], [devProcess])!.map((a) => a.key)).toEqual(['test/main']);
  });

  it('shows nothing yet — not an empty project — before the project answers', () => {
    expect(shownApps('daos', null, null, [devProcess])).toBeNull();
  });

  it('shows this daemon’s processes with no project selected', () => {
    expect(shownApps(null, null, null, [devProcess])!.map((a) => [a.key, a.name, a.stack, a.remote])).toEqual([
      ['daos/dev/main', 'main', 'dev', false],
    ]);
  });
});


describe('a detail page that took one process for the app, and a default for a count', () => {
  const sub = (name: string, pid: number) => ({
    name,
    type: 'custom' as const,
    pid,
    status: 'online' as const,
    cpu: 0,
    memory: 0,
    uptime: 0,
    restarts: 0,
    instances: 1,
    declaredInstances: 1,
  }) satisfies SubProcessInfoDto;

  it('names the process the diagnostics measured when the app has several', () => {
    const main = { processes: [sub('http', 57952), sub('captcha-generator', 58001), sub('notification-worker', 58130)] };
    expect(measuredProcess(main, 58130)?.name).toBe('notification-worker');
  });

  it('names none when the process is the app', () => {
    expect(measuredProcess({ processes: [sub('http', 7)] }, 7)).toBeUndefined();
    expect(measuredProcess({}, 7)).toBeUndefined();
  });

  it('counts traffic only when the daemon says it was measured', () => {
    const measured = { cpu: 1, memory: 1, traffic: 'measured' as const, requests: 0, errors: 0 };
    expect(countedTraffic(measured)).toBe(measured);
    expect(countedTraffic({ cpu: 1, memory: 1, traffic: 'not-reported' })).toBeNull();
    // A daemon from before the field answered `requests: 0` by default.
    expect(countedTraffic({ cpu: 1, memory: 1, requests: 0, errors: 0 } as never)).toBeNull();
    expect(countedTraffic(null)).toBeNull();
  });
});
