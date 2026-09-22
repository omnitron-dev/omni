/**
 * Every deployment stopped the node's daemon, and everything under it.
 *
 * Provisioning ends with `omnitron down 2>/dev/null; omnitron up --slave`.
 * The comment beside it said «or restart if already running», which is true
 * and understates the price: `down` stops the daemon AND all six
 * applications, and `up` boots them again through its boot-resume.
 *
 * Attributing it took three deployments, because two paths restarted the
 * applications and either one alone explained the pids. With the node-side
 * `stack start` closed by `decideNodeStackStart`, the 2026-09-22 deployment
 * that had nothing to do reads:
 *
 *     07:25:46  Slave node provisioned
 *     07:25:47  every application on the node starts, 1–3 s later
 *     07:26:15  its stack was not restarted   started=false
 *     07:26:21  Left running — this deployment changes nothing   ×6
 *
 * The applications came back a second after provisioning and half a minute
 * before the deployment decided to leave them alone.
 *
 * What earns a restart is a change UNDER the daemon, and `plan.steps` is that
 * list: an empty plan means the host already had its runtime and its
 * omnitron. Everything else — a daemon that is down, one running as a master,
 * one that will not say — restarts, because a node that cannot be described
 * is a node rebuilt from a known state.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripComments } from '../../../../scripts/lib/strip-comments.mjs';
import { decideSlaveDaemonRestart } from '../../src/services/redeploy-decision.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const slave = { running: true, role: 'slave' as const };

describe('taking a node daemon down', () => {
  it('leaves it alone when nothing under it changed and it is already a slave', () => {
    const decision = decideSlaveDaemonRestart({ hostChanged: false, daemon: slave });

    expect(decision.action).toBe('leave');
    expect(decision.because).toBe(
      'the node daemon is already running as a slave and nothing under it changed',
    );
  });

  it('restarts when the host was prepared — the runtime moved under it', () => {
    const decision = decideSlaveDaemonRestart({ hostChanged: true, daemon: slave });

    expect(decision.action).toBe('restart');
    expect(decision.because).toMatch(/host was prepared/);
  });

  it('restarts when the node would not say what its daemon is doing', () => {
    // `omnitron status --json` that fails to run, or prints something this
    // cannot parse. Unknown is not «fine».
    const decision = decideSlaveDaemonRestart({ hostChanged: false, daemon: null });

    expect(decision.action).toBe('restart');
    expect(decision.because).toMatch(/would not say/);
  });

  it('restarts when the daemon is down', () => {
    const decision = decideSlaveDaemonRestart({
      hostChanged: false,
      daemon: { running: false, role: 'slave' },
    });

    expect(decision.action).toBe('restart');
    expect(decision.because).toBe('the node daemon is not running');
  });

  it('leaves one that names no role — absent is not wrong', () => {
    // The node measured on 2026-09-22 reports no `role` at all, so the first
    // version of this rule — `role !== 'slave'` — could never be satisfied
    // and took six applications down on every deployment to say so:
    //
    //     because=the node daemon is running as no role it would name
    //     steps=0  role=null  pid=1237622  uptime=273875
    //
    // A guard keyed on a value nobody writes always fires.
    const decision = decideSlaveDaemonRestart({ hostChanged: false, daemon: { running: true } });

    expect(decision.action).toBe('leave');
    expect(decision.because).toBe(
      'the node daemon is running, it does not name a role, and nothing under it changed',
    );
  });

  it('still restarts one that says it is a master', () => {
    const decision = decideSlaveDaemonRestart({
      hostChanged: false,
      daemon: { running: true, role: 'master' },
    });

    expect(decision.action).toBe('restart');
    expect(decision.because).toBe('the node daemon is running as a master, not as a slave');
  });
});

describe('where the deployment asks', () => {
  const deployer = stripComments(
    fs.readFileSync(path.join(here, '../../src/services/remote-deployer.service.ts'), 'utf8'),
  );

  it('asks the node before deciding, and decides before taking it down', () => {
    const asks = deployer.indexOf("'omnitron status --json 2>&1'");
    const decides = deployer.indexOf('decideSlaveDaemonRestart({');
    const takesDown = deployer.indexOf('omnitron down 2>/dev/null');

    expect(asks).toBeGreaterThan(-1);
    expect(asks).toBeLessThan(decides);
    expect(decides).toBeLessThan(takesDown);
  });

  it('runs the down-and-up under that decision rather than unconditionally', () => {
    const between = deployer.slice(
      deployer.indexOf('decideSlaveDaemonRestart({'),
      deployer.indexOf('omnitron down 2>/dev/null'),
    );

    expect(between).toMatch(/daemonDecision\.action === 'leave'/);
  });

  it('says which of the two it did, and says it at the same volume', () => {
    // Both branches log. The first version of this logged only the one that
    // declined, and it cost a deployment to find out why the other had
    // fired: «restart» left nothing behind but the restart itself. A
    // decision that speaks only when it says no cannot be audited when it
    // says yes.
    expect(deployer).toMatch(/The node daemon was left alone/);
    expect(deployer).toMatch(/Taking the node daemon down and back up/);

    const restartLog = deployer.indexOf('Taking the node daemon down and back up');
    const takesDown = deployer.indexOf('omnitron down 2>/dev/null');
    expect(restartLog).toBeLessThan(takesDown);
  });

  it('carries what it saw, not only what it concluded', () => {
    // `because` is the verdict; `role`, `pid`, `uptime` and `steps` are the
    // evidence. Without them the next reader repeats the deployment that
    // produced this line.
    const block = deployer.slice(
      deployer.indexOf('Taking the node daemon down and back up') - 600,
      deployer.indexOf('Taking the node daemon down and back up'),
    );

    for (const field of ['because:', 'steps:', 'role:', 'pid:', 'uptime:']) {
      expect(block, field).toContain(field);
    }
  });

  it('reads the plan it just ran as the sign that something changed', () => {
    // Not a flag somebody has to remember to set: `plan.steps` is the list of
    // commands provisioning actually executed on that host, a line above.
    expect(deployer).toMatch(/hostChanged: plan\.steps\.length > 0/);
  });
});
