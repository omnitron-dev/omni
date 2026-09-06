/**
 * What `omnitron doctor` says about the parts it could not look at.
 *
 * "No problems found" and "nothing was looked at" produced the same output
 * before this, and they send an operator in opposite directions: the first
 * says the fault is elsewhere, the second says look again. A database that
 * is not answering takes five checks down with it and a daemon that is not
 * answering takes seven, and in both cases the report was one error with a
 * silence underneath it.
 *
 * The live run this was written from is the reason the skip reason is
 * derived rather than fixed: the first version said all five checks "may not
 * have been checked — a query failed partway through" when the very first
 * query had been refused and none of them had run. A diagnostic may be wrong
 * about the system; it may not be wrong about itself.
 */

import net from 'node:net';
import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';

import { Findings, checkConsoleServing } from '../../src/commands/doctor.js';
import type { IDaemonConfig } from '../../src/config/types.js';

/** A port nothing is listening on: bound to learn the number, then released. */
async function deadPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe('Findings', () => {
  it('keeps what was not examined apart from what was found', () => {
    const findings = new Findings();
    findings.add({ id: 'db.unreachable', severity: 'error', title: 'x', evidence: [] });
    findings.skip('logs.health', 'the database is unreachable');

    expect(findings.all()).toHaveLength(1);
    expect(findings.skipped()).toEqual([{ id: 'logs.health', reason: 'the database is unreachable' }]);
  });

  it('reports no skips when everything ran', () => {
    const findings = new Findings();
    findings.add({ id: 'app.errored', severity: 'warning', title: 'x', evidence: [] });

    expect(findings.skipped()).toEqual([]);
  });

  it('does not let a skip change the severity of the run', () => {
    // A gap is not a problem with the platform. It has to be visible without
    // turning a clean run into a failing one, or an operator learns to run
    // the command with the console deliberately stopped to get a green box.
    const findings = new Findings();
    findings.skip('webapp.serving', 'nothing is listening');

    expect(findings.worst).toBeNull();
    expect(findings.all()).toEqual([]);
  });
});

describe('checkConsoleServing', () => {
  it('records a skip, not a finding, when nothing is listening', async () => {
    // `omnitron webapp` is opt-in, so a daemon without a console is a normal
    // configuration — but it is not a clean bill of health for the console
    // either, and the two used to print identically.
    const findings = new Findings();
    const port = await deadPort();

    await checkConsoleServing(findings, { httpPort: port } as IDaemonConfig);

    expect(findings.all()).toEqual([]);
    expect(findings.skipped().map((s) => s.id)).toEqual(['webapp.not-serving']);
    expect(findings.skipped()[0]!.reason).toContain(String(port));
  });

  it('does not record a skip when the console answers', async () => {
    const server = net.createServer();
    try {
      const http = await import('node:http');
      const srv = http.createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<!doctype html><title>omnitron</title>');
      });
      await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
      const port = (srv.address() as net.AddressInfo).port;

      const findings = new Findings();
      await checkConsoleServing(findings, { httpPort: port } as IDaemonConfig);

      expect(findings.skipped()).toEqual([]);

      await new Promise<void>((resolve) => srv.close(() => resolve()));
    } finally {
      server.close();
    }
  });
});

/**
 * Every id a skip names has to be one a check actually reports under.
 *
 * The first version of the skip list invented them: `db.bloat` where the
 * check reports `db.bloated`, and `logs.health` for a check that reports
 * three ids and none by that name. The lists were meant to line up so a
 * reader could match a gap against a finding, and they did not line up at
 * all — the field was a name that is not an address.
 *
 * Both lists are read out of the source rather than restated here: restating
 * them is how they drifted in the first place.
 */
describe('skip ids', () => {
  const source = readFileSync(new URL('../../src/commands/doctor.ts', import.meta.url), 'utf8');

  /**
   * Every id passed to `findings.add({ id: ... })`.
   *
   * Three shapes, and the first version of this only saw one: a plain
   * literal, a template (`app.${app.status}`), and a ternary picking between
   * two literals (`disk.exhausted` / `disk.low`). Missing the ternary made
   * this test fail on `disk.*` — a gap in the probe reported as a defect in
   * the code, which is why the assertion has to be able to pass before it is
   * worth believing when it fails.
   */
  const reported = new Set(
    [...source.matchAll(/^\s*id:\s*(.+),$/gm)].flatMap((m) =>
      [...m[1]!.matchAll(/[`']([a-z][a-z0-9.*${}-]*)[`']/g)].map((x) => x[1]!)
    )
  );
  /** `app.${app.status}` reports under the `app.` prefix, whatever the status. */
  const prefixes = new Set([...reported].map((id) => id.split('.')[0]!));

  /** Every id passed to `findings.skip(...)` as a literal, plus the table. */
  const skipped = new Set([
    ...[...source.matchAll(/findings\.skip\(\s*'([^']+)'/g)].map((m) => m[1]!),
    ...[...source.matchAll(/\['([a-z][a-z0-9.*-]*)',\s*'[^']*'\],/g)].map((m) => m[1]!),
  ]);

  it('reads both lists out of the source', () => {
    // Guard the guard: an empty side would make the assertion below vacuous,
    // and this test's whole value is that it fails when the lists disagree.
    expect(reported.size).toBeGreaterThan(15);
    expect(skipped.size).toBeGreaterThan(8);
  });

  it.each([...skipped])('%s is an id some check reports under', (id) => {
    if (id.endsWith('.*')) {
      expect(prefixes).toContain(id.slice(0, -2));
    } else {
      expect(reported).toContain(id);
    }
  });
});
