/**
 * The console showed that a node was down and never why.
 *
 * Every health check records three layers with their own error string — ping,
 * SSH, and the daemon's own answer. `getCheckHistory` returned all of it and
 * had **no caller anywhere in this console**: the uptime bar showed two ratios
 * per bucket, and the live check's errors reached the page only inside a
 * `tooltip`, one indicator on one card at a time.
 *
 * So an operator could see that a node had been unreachable for six hours and
 * had to open a terminal to find out whether the box was off, the key was
 * rejected, or the daemon had crashed — three problems with three different
 * remedies, all recorded, none shown.
 *
 * These pin the two rules the reading turns on.
 */

import { describe, it, expect } from 'vitest';

import { verdictOf, firstReason, isMeasured } from './node-diagnosis';

describe('an absence is not a failure', () => {
  it('reads a null layer as not measured', () => {
    // The daemon's own fallback check pings and probes the Netron port and
    // never opens an SSH session. It has no opinion about SSH.
    expect(verdictOf(null, null)).toBe('unmeasured');
    expect(verdictOf(undefined, undefined)).toBe('unmeasured');
  });

  it('does not let a missing measurement read as refused', () => {
    // The precise defect this console shipped once: the fallback wrote
    // `false` for SSH, every reader takes `false` as "refused", and the page
    // said "Waiting for SSH connection" about a node whose SSH works — while
    // never showing `omnitronError`, which held the actual reason. An absence
    // rendered as a failure sends the operator to fix the wrong layer.
    expect(verdictOf(null, null)).not.toBe('failed');
  });

  it('still calls it failed when something was tried and did not work', () => {
    expect(verdictOf(false, 'Connection refused')).toBe('failed');
    expect(verdictOf(false, null)).toBe('failed');
    // An error with no boolean is an attempt that failed, not an absence.
    expect(verdictOf(null, 'Host key verification failed')).toBe('failed');
  });

  it('calls a success a success', () => {
    expect(verdictOf(true, null)).toBe('ok');
    // A stale error beside a current success is not a failure. The boolean is
    // the measurement; the string is only its explanation.
    expect(verdictOf(true, 'previous attempt timed out')).toBe('ok');
  });
});

describe('the reason to show is the first failing layer', () => {
  it('names the host before the ones that could not be reached past it', () => {
    // `connect ECONNREFUSED` underneath `Host unreachable` explains nothing
    // and points at the wrong repair: the daemon is not refusing, the machine
    // is not answering.
    expect(
      firstReason({
        pingReachable: false,
        pingError: 'Host unreachable',
        sshConnected: false,
        sshError: 'connect ETIMEDOUT',
        omnitronConnected: false,
        omnitronError: 'connect ECONNREFUSED 10.0.0.4:8090',
      }),
    ).toBe('Host unreachable');
  });

  it('names SSH when the box answers but will not let you in', () => {
    expect(
      firstReason({
        pingReachable: true,
        pingError: null,
        sshConnected: false,
        sshError: 'All configured authentication methods failed',
        omnitronConnected: false,
        omnitronError: 'no answer on the Netron port',
      }),
    ).toBe('All configured authentication methods failed');
  });

  it('names the daemon when both layers below it are fine', () => {
    expect(
      firstReason({
        pingReachable: true,
        sshConnected: true,
        omnitronConnected: false,
        omnitronError: 'ECONNREFUSED — no daemon listening on 8090',
      }),
    ).toBe('ECONNREFUSED — no daemon listening on 8090');
  });

  it('has nothing to say about a healthy check', () => {
    expect(firstReason({ pingReachable: true, sshConnected: true, omnitronConnected: true })).toBeNull();
  });
});

describe('a check that measured nothing is not an outage', () => {
  it('says so', () => {
    // The same distinction the uptime bar makes when it reports -1 for a
    // bucket no check could measure, instead of folding those into the
    // denominator and pulling the figure towards zero.
    expect(isMeasured({})).toBe(false);
    expect(isMeasured({ pingReachable: null, sshConnected: null, omnitronConnected: null })).toBe(false);
  });

  it('counts a check that reached even one layer', () => {
    expect(isMeasured({ pingReachable: false, pingError: 'Host unreachable' })).toBe(true);
    expect(isMeasured({ omnitronConnected: true })).toBe(true);
  });
});
