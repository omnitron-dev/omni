/**
 * A log file nothing could read back: colour codes, and no date.
 *
 *     prettyStream({ colorize: true })
 *
 * `colorize` was unconditional, and the destination is not always a terminal.
 * Under omnitron every app's stdout is a FILE, so escape sequences were
 * written into `app.log` — and pino-pretty's default header is the time of
 * day alone:
 *
 *     [08:39:43] ERROR (titan-app/2758): Monero height did not advance
 *
 * Nothing in that line says which day it is. The day can only be recovered
 * from the record's position in the file, which is no help to `grep`, and the
 * clock is local while the JSON records in the very same file are UTC — three
 * hours apart on this machine, which is enough to conclude a stand was idle
 * for three hours when it had just restarted.
 *
 * Measured on the dev stand, per RECORD (a pretty record spans dozens of
 * lines when it carries a stack):
 *
 *     main        json   9 845   pretty 118 512   (92% pretty)
 *     paysys      json   4 571   pretty 102 358   (96% pretty)
 *     storage     json  29 746   pretty  40 626
 *     geo         json  11 814   pretty  10 036
 *     priceverse  json  42 217   pretty       0
 *     messaging   json  53 329   pretty       0
 *
 * The split itself is legitimate — priceverse and messaging set
 * `prettyPrint: false`, paysys sets `true`, main states nothing and takes the
 * development default — and this does not take that choice away. What it
 * fixes is what the pretty branch WRITES when nobody is watching a terminal.
 * (2026-09-23: that choice is now taken away where no terminal reads —
 * `a-record-the-collector-cut-into-lines`. What pretty writes still matters
 * at a terminal.)
 *
 * The cost of not fixing it, measured: a sweep over the stand's warnings that
 * read only the JSON records saw 8% of main's and 4% of paysys's, and missed
 * 52 506 records at warn level or above — more than it found. Among them were
 * the 23 792 Monero errors that turned out to be a chain between blocks.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import prettyStream from 'pino-pretty';

import { prettyStreamOptions } from '../../../src/modules/logger/logger.service.js';

/** Render one pino record through the real pretty stream, into a real file. */
function render(options: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'titan-pretty-'));
  const file = join(dir, 'app.log');
  try {
    const stream = prettyStream({ ...options, destination: file, sync: true } as never);
    stream.write(
      JSON.stringify({
        level: 50,
        time: Date.parse('2026-09-22T05:29:33.691Z'),
        pid: 2758,
        name: 'titan-app',
        msg: 'Monero height did not advance',
      }) + '\n',
    );
    return readFileSync(file, 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ESCAPE = /\u001b\[/;

describe('a record that could not say its day', () => {
  it('a record written to a file carries the date it was written on', () => {
    const line = render(prettyStreamOptions());

    expect(line, 'the record must name its day, not just the time of day').toMatch(
      /2026-09-22/,
    );
  });

  it('a file is not a terminal, so nothing colours it', () => {
    const line = render(prettyStreamOptions());

    expect(ESCAPE.test(line), `escape sequences reached the file: ${JSON.stringify(line.slice(0, 60))}`).toBe(
      false,
    );
  });

  it('the record still says what it always said', () => {
    // Control: the human-readable form is the point of this branch, and it
    // survives — level, process and message all still render.
    const line = render(prettyStreamOptions());

    expect(line).toMatch(/ERROR/);
    expect(line).toMatch(/titan-app\/2758/);
    expect(line).toMatch(/Monero height did not advance/);
  });

  it('a terminal still gets its colour', () => {
    // Control: this is not a way of turning colour off. Where somebody is
    // actually watching, the output is what it always was.
    const line = render(prettyStreamOptions(true));

    expect(ESCAPE.test(line), 'a terminal is exactly what colour is for').toBe(true);
    expect(line, 'and it still carries the date').toMatch(/2026-09-22/);
  });
});
