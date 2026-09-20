/**
 * A daemon upgrade removed the stack it was running.
 *
 * Omnitron sweeps containers labelled `omnitron.managed=true` that belong to
 * no stack it knows about. The reasoning is sound and the cost of being wrong
 * is not symmetric, which the guard's own comment says: "Leaving a real
 * orphan running costs an idle container; the other way costs the platform."
 *
 * It has cost the platform three times, and the third is the one that
 * matters: no reasoning about names or labels can reach the right answer on
 * a node, because its master's containers are labelled for a stack the node
 * does not have and never will. The rule is about WHO, not about what.
 *
 * **2026-09-12** — `listStacks` reads a cache the per-project load populates,
 * and the sweep ran before that load. Ten RUNNING containers went in fourteen
 * seconds: postgres, redis, bitcoin, monero (daemon and wallet), nominatim,
 * tor, tiles, minio, gateway. The fix loaded configs first and refused when
 * any project's stacks could not be read.
 *
 * **2026-09-20** — six containers on the test NODE, moments after a daemon
 * upgrade:
 *
 *     Removing orphan container (not part of any registered stack)  daos-test-pg
 *     Removing orphan container (not part of any registered stack)  daos-test-redis
 *     Removing orphan container (not part of any registered stack)  daos-test-tor
 *     Removing orphan container (not part of any registered stack)  daos-test-postgres
 *     Removing orphan container (not part of any registered stack)  daos-test-minio
 *     Removing orphan container (not part of any registered stack)  daos-test-gateway
 *
 * The onion went dark and the stack behind it went with it. The guard from
 * September 12th did not fire, for one reason: it lowers its flag inside
 * `for (const project of projects)`, and a SLAVE NODE has no registered
 * projects at all — it learns what to run from its master. The loop body
 * never ran, nothing lowered the flag, and an empty set of expectations
 * authorised removing everything.
 *
 * An empty list is not a complete list of nothing.
 *
 * Volumes survived both times (`docker rm -f`, no `-v`), so the price was a
 * cold restart rather than the data. That is luck, and not a reason to trust
 * the sweep.
 */

import { describe, it, expect } from 'vitest';

import { decideOrphans, type SweepCandidate } from '../../src/infrastructure/orphan-containers.js';

const container = (name: string, over: Partial<SweepCandidate> = {}): SweepCandidate => ({
  name,
  status: 'running',
  ...over,
});

/** The six that were removed on the node, as they were labelled. */
const THE_STACK = [
  container('daos-test-pg', { project: 'daos', stack: 'test' }),
  container('daos-test-redis', { project: 'daos', stack: 'test' }),
  container('daos-test-tor', { project: 'daos', stack: 'test' }),
  container('daos-test-postgres', { project: 'daos', stack: 'test' }),
  container('daos-test-minio', { project: 'daos', stack: 'test' }),
  container('daos-test-gateway', { project: 'daos', stack: 'test' }),
];

describe('a node has no projects of its own, and that is not an answer', () => {
  it('removes nothing when the daemon knows of no projects', () => {
    // The exact input from the node, and the assertion the defect fails: the
    // old guard only lowered its flag inside a loop over `projects`, so an
    // empty `projects` left `expectationsComplete` true and every container
    // unaccounted for.
    const d = decideOrphans({
      isSlave: false,
      managed: THE_STACK,
      projects: [],
      expectedPrefixes: [],
      expectationsComplete: true,
      internalNames: ['omnitron-pg', 'omnitron-nginx'],
    });

    expect(d.action).toBe('skip');
    if (d.action !== 'skip') return;
    expect(d.because).toMatch(/no projects of its own/);
  });

  it('removes nothing when no prefixes resolved, even with projects listed', () => {
    // The 2026-09-12 shape: projects present, configs not yet read, so every
    // container looks unexpected. Belt beside the `expectationsComplete`
    // brace, because that flag depends on a loop finding something to say.
    const d = decideOrphans({
      isSlave: false,
      managed: THE_STACK,
      projects: ['daos'],
      expectedPrefixes: [],
      expectationsComplete: true,
      internalNames: [],
    });

    expect(d.action).toBe('skip');
    if (d.action !== 'skip') return;
    expect(d.because).toMatch(/every container would look like an orphan/);
  });

  it('still honours the flag it was given', () => {
    const d = decideOrphans({
      isSlave: false,
      managed: THE_STACK,
      projects: ['daos'],
      expectedPrefixes: ['other-dev-'],
      expectationsComplete: false,
      internalNames: [],
    });

    expect(d.action).toBe('skip');
    if (d.action !== 'skip') return;
    expect(d.because).toMatch(/incomplete/);
  });
});

describe('a container labelled for a project this daemon does not have', () => {
  it('is left alone, because it is somebody else\'s bookkeeping', () => {
    // A master deploys `daos/test` onto a node that also runs its own
    // `acme/dev`. The node knows `acme` and not `daos`. Removing the daos
    // containers would be deciding a question this daemon was not asked.
    const d = decideOrphans({
      isSlave: false,
      managed: [
        container('acme-dev-postgres', { project: 'acme', stack: 'dev' }),
        container('daos-test-tor', { project: 'daos', stack: 'test' }),
      ],
      projects: ['acme'],
      expectedPrefixes: ['acme-dev-'],
      expectationsComplete: true,
      internalNames: [],
    });

    expect(d.action).toBe('skip');
  });

  it('removes one whose project IS this daemon\'s and whose stack is gone', () => {
    // The case the sweep exists for: a stack deleted from the config, its
    // containers still running. This is the only shape that may be removed.
    const d = decideOrphans({
      isSlave: false,
      managed: [
        container('acme-dev-postgres', { project: 'acme', stack: 'dev' }),
        container('acme-old-postgres', { project: 'acme', stack: 'old' }),
      ],
      projects: ['acme'],
      expectedPrefixes: ['acme-dev-'],
      expectationsComplete: true,
      internalNames: [],
    });

    expect(d).toEqual({ action: 'remove', containers: ['acme-old-postgres'] });
  });

  it('removes an unlabelled one under a known project\'s prefix scheme', () => {
    // A legacy container from before `stackLabels()` existed carries no
    // project label. It is judged by name, as it always was — the label check
    // narrows what may be removed and must not widen it.
    const d = decideOrphans({
      isSlave: false,
      managed: [container('acme-gone-redis')],
      projects: ['acme'],
      expectedPrefixes: ['acme-dev-'],
      expectationsComplete: true,
      internalNames: [],
    });

    expect(d).toEqual({ action: 'remove', containers: ['acme-gone-redis'] });
  });
});

describe('what is never touched', () => {
  it('keeps omnitron\'s own containers', () => {
    const d = decideOrphans({
      isSlave: false,
      managed: [container('omnitron-pg'), container('omnitron-nginx')],
      projects: ['acme'],
      expectedPrefixes: ['acme-dev-'],
      expectationsComplete: true,
      internalNames: ['omnitron-pg', 'omnitron-nginx'],
    });

    expect(d.action).toBe('skip');
  });

  it('keeps everything matching an expected prefix', () => {
    const d = decideOrphans({
      isSlave: false,
      managed: THE_STACK,
      projects: ['daos'],
      expectedPrefixes: ['daos-test-'],
      expectationsComplete: true,
      internalNames: [],
    });

    expect(d.action).toBe('skip');
    if (d.action !== 'skip') return;
    expect(d.because).toMatch(/accounted for/);
  });

  it('says so when there is nothing managed at all', () => {
    const d = decideOrphans({
      isSlave: false,
      managed: [],
      projects: [],
      expectedPrefixes: [],
      expectationsComplete: true,
      internalNames: [],
    });

    expect(d.action).toBe('skip');
  });
});

describe('a node does not sweep its master\'s host', () => {
  /**
   * The third time, and the one that no reasoning about names or labels can
   * reach. After the master wrote the node a project config, the node HAD a
   * project — so the empty-list guard passed, expectations were complete, and
   * prefixes resolved. The master's containers are labelled with a project
   * the node now knows (`daos`) and a stack it does not (`test`), so every
   * rule said "orphan" and meant "somebody else's":
   *
   *     Removing orphan container (not part of any registered stack)  daos-test-redis
   *     Removing orphan container (not part of any registered stack)  daos-test-postgres
   *     Removing orphan container (not part of any registered stack)  daos-test-tor
   *
   * A slave does not own the inventory of its host. It is TOLD what to
   * provision, under the master's own names, and sweeping is a daemon
   * deleting what it was asked to run on the grounds that nobody asked it.
   */
  it('removes nothing, however complete its own picture looks', () => {
    const d = decideOrphans({
      isSlave: true,
      managed: THE_STACK,
      projects: ['daos'],
      expectedPrefixes: ['daos-deployed-'],
      expectationsComplete: true,
      internalNames: ['omnitron-pg'],
    });

    expect(d.action).toBe('skip');
    if (d.action !== 'skip') return;
    expect(d.because).toMatch(/node under a master/);
  });

  it('is asked before anything else, so no later rule can overrule it', () => {
    const d = decideOrphans({
      isSlave: true,
      managed: [container('acme-old-postgres', { project: 'acme', stack: 'old' })],
      projects: ['acme'],
      expectedPrefixes: ['acme-dev-'],
      expectationsComplete: true,
      internalNames: [],
    });

    expect(d.action).toBe('skip');
  });

  it('still lets a master sweep its own host', () => {
    const d = decideOrphans({
      isSlave: false,
      managed: [container('acme-old-postgres', { project: 'acme', stack: 'old' })],
      projects: ['acme'],
      expectedPrefixes: ['acme-dev-'],
      expectationsComplete: true,
      internalNames: [],
    });

    expect(d).toEqual({ action: 'remove', containers: ['acme-old-postgres'] });
  });
});
