/**
 * An app list that showed one stack of two, and a detail page that asked for
 * an app no daemon has.
 *
 * Measured on the master 2026-09-23 with project `sample`, all stacks selected:
 * /apps listed six rows for twelve deployments (dev's, never test's), and
 * /apps/main answered «App with id sample/main not found» — four 404s a poll —
 * because the page prepended `sample/` to the name, which is a handle of
 * nothing.
 */

import { describe, it, expect } from 'vitest';

import type { IProjectAppStatus } from '@omnitron-dev/omnitron/dto/services';

import { daemonNameFor, deploymentsIn, detailHref, isLocal } from './app-address';

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

const devMain = deployment('dev', 'local', 'main', 'sample/dev/main');
const testMain = deployment('test', 'remote', 'main', 'sample/deployed/main');

describe('an app list that showed one stack of two', () => {
  it('lists every deployment with all stacks selected, and one stack’s with one', () => {
    expect(deploymentsIn([devMain, testMain], null)).toEqual([devMain, testMain]);
    expect(deploymentsIn([devMain, testMain], 'test')).toEqual([testMain]);
  });

  it('links a local deployment by its handle, and a remote one nowhere the daemon cannot answer', () => {
    expect(detailHref(devMain)).toBe('/apps/sample%2Fdev%2Fmain');
    expect(isLocal(devMain)).toBe(true);
    expect(isLocal(testMain)).toBe(false);
  });
});

describe('a detail page that asked for an app no daemon has', () => {
  it('asks for a handle as it is, whatever is selected', () => {
    expect(daemonNameFor('sample/dev/main', 'sample', null)).toBe('sample/dev/main');
    expect(daemonNameFor('sample/dev/main', 'sample', 'test')).toBe('sample/dev/main');
  });

  it('qualifies a bare name with the selected stack', () => {
    expect(daemonNameFor('main', 'sample', 'dev')).toBe('sample/dev/main');
  });

  it('leaves a bare name bare with all stacks selected — never project/name', () => {
    expect(daemonNameFor('main', 'sample', null)).toBe('main');
  });
});
