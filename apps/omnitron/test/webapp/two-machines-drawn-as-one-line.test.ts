/**
 * Every chart line was named by its app, and a fleet runs the same app names
 * on every machine.
 *
 * `omnitron` itself reports `cpu_percent` and `memory_bytes` on every node.
 * Replicated samples arrive carrying a `node` label and titan-metrics groups
 * series by `name|app|labels`, so two machines correctly produce two series
 * — and the page named both of them `omnitron`. Two lines with one name: the
 * legend cannot separate them, and the shape reads as one app flapping
 * between two values rather than as two machines.
 *
 * Measured on the first node to join the mesh: 785 samples arrived under
 * `app: omnitron`, `node: 16f3dd5a-…`, alongside the master's own.
 */

import { describe, it, expect } from 'vitest';

import { seriesLabel } from '../../webapp/src/pages/metrics.js';

const NAMES = { '16f3dd5a-2727-49e5-90a2-d762b57073f6': 'daos-test' };

describe('naming a chart line', () => {
  it("leaves the master's own readings alone", () => {
    expect(seriesLabel({ app: 'payments', labels: { source: 'daemon' } }, NAMES)).toBe('payments');
  });

  it('says which machine a remote reading came from', () => {
    expect(
      seriesLabel({ app: 'omnitron', labels: { node: '16f3dd5a-2727-49e5-90a2-d762b57073f6' } }, NAMES),
    ).toBe('omnitron · daos-test');
  });

  it('separates two machines running the same app', () => {
    const master = seriesLabel({ app: 'omnitron', labels: {} }, NAMES);
    const remote = seriesLabel({ app: 'omnitron', labels: { node: '16f3dd5a-2727-49e5-90a2-d762b57073f6' } }, NAMES);

    expect(master).not.toBe(remote);
  });

  it('falls back to the uuid rather than to an indistinguishable name', () => {
    // Ugly and true. The app name alone would be neither: it would put two
    // machines back under one label at exactly the moment the node list is
    // unavailable.
    expect(seriesLabel({ app: 'omnitron', labels: { node: 'unknown-id' } }, {})).toBe('omnitron · unknown-id');
  });

  it('strips the project namespace, in one place', () => {
    // `filterSeries` used to strip this too, so two pieces of code decided
    // what a line is called and only one of them knew about nodes.
    expect(seriesLabel({ app: 'daos/payments', labels: {} }, NAMES)).toBe('payments');
    expect(
      seriesLabel({ app: 'daos/payments', labels: { node: '16f3dd5a-2727-49e5-90a2-d762b57073f6' } }, NAMES),
    ).toBe('payments · daos-test');
  });

  it('survives a series with no labels at all', () => {
    expect(seriesLabel({ app: 'payments' }, NAMES)).toBe('payments');
  });

  it('keeps the app of a child process, so four http processes are four names', () => {
    expect(seriesLabel({ app: 'daos/dev/main/http', labels: {} }, NAMES)).toBe('main/http');
    expect(seriesLabel({ app: 'daos/dev/storage/http', labels: {} }, NAMES)).toBe('storage/http');
    expect(seriesLabel({ app: 'daos/dev/main', labels: {} }, NAMES)).toBe('main');
    expect(
      seriesLabel({ app: 'daos/deployed/main/http', labels: { node: '16f3dd5a-2727-49e5-90a2-d762b57073f6' } }, NAMES),
    ).toBe('main/http · daos-test');
  });
});
