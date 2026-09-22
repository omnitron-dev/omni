/**
 * Six «Left running» lines about six applications the same deployment had
 * just restarted.
 *
 * Measured on 2026-09-22 against `daos/test`, a deployment with nothing to
 * do — every build skipped, every artifact already on the node, not a byte
 * transferred:
 *
 *     05:51:20  The node now knows what to run   changed=false
 *               detail: «Stack daos/deployed started — 6/6 apps online»
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

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripComments } from '../../../../scripts/lib/strip-comments.mjs';
import { decideNodeStackStart } from '../../src/services/redeploy-decision.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SIX = ['main', 'storage', 'priceverse', 'paysys', 'messaging', 'geo'];
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
      online: online('main', 'storage', 'priceverse', 'messaging', 'geo'),
    });

    expect(decision.action).toBe('start');
    // The name, not just the count: «1 of 6 are not running» sends the
    // reader to the node to find out which, which this already knows.
    expect(decision.because).toBe('1 of 6 are not running on the node: paysys');
  });

  it('starts when the node could not be asked — an empty answer is not «all of them»', () => {
    // `appsOnline` returns an empty set when the ssh call fails, and has
    // done so deliberately since it was written. A skip on that answer
    // would leave a node down and call it unchanged.
    const decision = decideNodeStackStart({ configChanged: false, apps: SIX, online: online() });

    expect(decision.action).toBe('start');
    expect(decision.because).toBe(
      '6 of 6 are not running on the node: main, storage, priceverse, paysys, messaging, geo',
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
      online: online('priceverse', 'geo'),
    });

    expect(decision.action).toBe('start');
    expect(decision.because).toBe('2 of 2 are not running on the node: main, storage');
  });
});

describe('the order the deployment asks in', () => {
  const deployer = stripComments(
    fs.readFileSync(path.join(here, '../../src/services/remote-deployer.service.ts'), 'utf8'),
  );

  it('decides before it tells the node — the defect was the other order', () => {
    const decides = deployer.indexOf('decideNodeStackStart({');
    const tells = deployer.indexOf('`omnitron stack start ${shellEscape(project)}');

    expect(decides).toBeGreaterThan(-1);
    expect(tells).toBeGreaterThan(-1);
    expect(decides).toBeLessThan(tells);
  });

  it('runs the node-side start under that decision rather than unconditionally', () => {
    const tells = deployer.indexOf('`omnitron stack start ${shellEscape(project)}');
    // The command now sits inside the `start.action === 'start'` arm; the
    // text between the decision and the command is what makes it
    // conditional, and an edit that drops the condition drops this too.
    const between = deployer.slice(deployer.indexOf('decideNodeStackStart({'), tells);

    expect(between).toMatch(/start\.action === 'start'/);
  });

  it('still asks the node what is online before deciding', () => {
    const asks = deployer.indexOf('online: await this.appsOnline(target, project)');
    const decides = deployer.indexOf('decideNodeStackStart({');

    expect(asks).toBeGreaterThan(decides);
    expect(asks).toBeLessThan(deployer.indexOf('`omnitron stack start ${shellEscape(project)}'));
  });

  it('says which of the two it did, in words the reader can tell apart', () => {
    expect(deployer).toMatch(/'The node now knows what to run'/);
    expect(deployer).toMatch(/its stack was not restarted/);
  });
});
