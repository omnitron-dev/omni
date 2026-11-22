/**
 * Six «Left running» lines about six applications the same deployment had
 * just restarted.
 *
 * Measured on 2026-09-22 against `sample/test`, a deployment with nothing to
 * do — every build skipped, every artifact already on the node, not a byte
 * transferred:
 *
 *     05:51:20  The node now knows what to run   changed=false
 *               detail: «Stack sample/deployed started — 6/6 apps online»
 *     05:51:26  Left running — this deployment changes nothing for this app  ×6
 *     05:51:40  every app on the node reports a new pid
 *
 * `decideRedeploy` was right about all six and had already been overruled.
 * Registering the node's config ends in an unconditional `omnitron stack
 * start` ON THE NODE, which starts everything that config lists; the per-app
 * decision runs after it, and reads `appsOnline` — by then every app is up,
 * started moments ago by this deployment, so `leave` is the answer to a
 * question the restart has already settled. The master's log said the apps
 * were left alone. The node's pids said otherwise, and the pids are the fact.
 *
 * So the question has to be asked before the node is told. What is pinned
 * here is that order, and the direction of every uncertainty: a node that
 * cannot be asked is a node whose apps get started.
 */

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripComments } from '../../../../scripts/lib/strip-comments.mjs';
import { RemoteDeployer, type DeployTarget } from '../../src/services/remote-deployer.service.js';
import { nodeStackActivationCommand, NodeRegistrationUnconfirmed } from '../../src/services/node-registration.js';
import { decideNodeStackStart } from '../../src/services/redeploy-decision.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SIX = ['main', 'storage', 'quotes', 'payments', 'messaging', 'geo'];
const online = (...apps: string[]): ReadonlySet<string> => new Set(apps);

describe('telling a node to start what it is already running', () => {
  it('leaves the stack alone when every app is up and the config did not move', () => {
    const decision = decideNodeStackStart({
      configChanged: false,
      apps: SIX,
      online: online(...SIX),
    });

    expect(decision.action).toBe('leave');
    expect(decision.because).toBe('all 6 are running with the configuration they already had');
  });

  it('starts when the configuration moved, however much is already running', () => {
    const decision = decideNodeStackStart({
      configChanged: true,
      apps: SIX,
      online: online(...SIX),
    });

    expect(decision.action).toBe('start');
    expect(decision.because).toMatch(/configuration/);
  });

  it('starts when one of six is down, and says which one', () => {
    const decision = decideNodeStackStart({
      configChanged: false,
      apps: SIX,
      online: online('main', 'storage', 'quotes', 'messaging', 'geo'),
    });

    expect(decision.action).toBe('start');
    // The name, not just the count: «1 of 6 are not running» sends the
    // reader to the node to find out which, which this already knows.
    expect(decision.because).toBe('1 of 6 are not running on the node: payments');
  });

  it('starts when the node could not be asked — an empty answer is not «all of them»', () => {
    // `appsOnline` returns an empty set when the ssh call fails, and has
    // done so deliberately since it was written. A skip on that answer
    // would leave a node down and call it unchanged.
    const decision = decideNodeStackStart({ configChanged: false, apps: SIX, online: online() });

    expect(decision.action).toBe('start');
    expect(decision.because).toBe(
      '6 of 6 are not running on the node: main, storage, quotes, payments, messaging, geo',
    );
  });

  it('starts when no app was named at all', () => {
    const decision = decideNodeStackStart({ configChanged: false, apps: [], online: online(...SIX) });

    expect(decision.action).toBe('start');
    expect(decision.because).toMatch(/no app was named/);
  });

  it('is not fooled by a node running something else of the same count', () => {
    const decision = decideNodeStackStart({
      configChanged: false,
      apps: ['main', 'storage'],
      online: online('quotes', 'geo'),
    });

    expect(decision.action).toBe('start');
    expect(decision.because).toBe('2 of 2 are not running on the node: main, storage');
  });
});

describe('the order the deployment asks in', () => {
  const deployer = stripComments(
    fs.readFileSync(path.join(here, '../../src/services/remote-deployer.service.ts'), 'utf8'),
  );

  async function registration(onlineNames: string[], confirmed: boolean) {
    const events: string[] = [];
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const service = new RemoteDeployer(logger as never, {} as never);
    const remote = service as unknown as {
      askNodeStatus(target: DeployTarget): Promise<{ raw: string; code: number; words: string }>;
      sshExec(target: DeployTarget, command: string, timeout?: number, input?: string): Promise<string>;
    };
    const dir = '/opt/omnitron/projects/fixture';
    let operation = '';
    vi.spyOn(remote, 'askNodeStatus').mockImplementation(async () => {
      events.push('observe');
      const apps = onlineNames.map(name => ({ name, status: 'online' }));
      return { raw: JSON.stringify({ data: { apps } }), code: 0, words: '' };
    });
    vi.spyOn(remote, 'sshExec').mockImplementation(async (_target, command, _timeout, input) => {
      if (input) {
        operation = JSON.parse(input).operation;
        events.push('publish');
        return JSON.stringify({ changed: false });
      }
      if (command.startsWith('omnitron project add ')) {
        events.push('register');
        return 'Project registered';
      }
      if (command === nodeStackActivationCommand(dir, operation, 'fixture', 'deployed')) {
        events.push('start');
        throw Object.assign(new Error('Reply lost'), { code: 'EXECUTION_OUTCOME_UNKNOWN' });
      }
      if (command === nodeStackActivationCommand(dir, operation, 'fixture', 'deployed', true)) {
        events.push('read receipt');
        return JSON.stringify({ operation, project: 'fixture', stack: 'deployed', confirmed, apps: ['api'] });
      }
      events.push('unexpected remote effect');
      throw Error('Unexpected remote operation');
    });
    const result = service['registerNodeApps']({ host: 'node' }, 'fixture',
      [{ name: 'api' }], [{ app: 'api', version: '1' }], undefined, undefined, 'test');
    return { events, result };
  }

  it('observes the right project before deciding to leave its running app alone', async () => {
    const { result, events } = await registration(['fixture/deployed/api'], false);
    await expect(result).resolves.toEqual({ changed: false });
    expect(events).toEqual(['publish', 'register', 'observe']);
  });

  it('recovers the reply to the original start when only a different project was online', async () => {
    const { result, events } = await registration(['other/deployed/api'], true);
    await expect(result).resolves.toEqual({ changed: false });
    expect(events).toEqual(['publish', 'register', 'observe', 'start', 'read receipt']);
  });

  it('preserves the boot definitions and reports an unconfirmed start when no receipt exists', async () => {
    const { result, events } = await registration([], false);
    await expect(result).rejects.toBeInstanceOf(NodeRegistrationUnconfirmed);
    expect(events).toEqual(['publish', 'register', 'observe', 'start', 'read receipt']);
  });

  it('says which of the two it did, in words the reader can tell apart', () => {
    expect(deployer).toMatch(/'The node now knows what to run'/);
    expect(deployer).toMatch(/its stack was not restarted/);
  });

  it('logs a restarted application as loudly as one it left alone', () => {
    // «Left running» logs; restarting logged nothing, so the two outcomes
    // differed in the log only by the absence of a line — and absence is
    // what a reader cannot see. Measured 2026-09-22: six artifacts
    // delivered, six applications restarted, and nothing between «Opened
    // the gateway's path» and «Stack started» that said so.
    expect(deployer).toMatch(/'Left running — this deployment changes nothing for this app'/);
    expect(deployer).toMatch(/'Restarted onto the artifact this deployment installed'/);

    // And it carries the reason the decision gave, not just the fact.
    const restarted = deployer.indexOf('Restarted onto the artifact this deployment installed');
    expect(deployer.slice(restarted - 300, restarted)).toMatch(/because: decision\.because/);
  });
});
