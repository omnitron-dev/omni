/**
 * An alert said on the screen.
 *
 * A fired alert was a row the console read while it was open, and nothing
 * else read: the master's disk filled three times with nobody told. The
 * owner's decision, 2026-09-29: a critical alert is said on the master's
 * desktop when it fires and when it resolves; a warning stays in the console.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const said = vi.hoisted(() => [] as Array<{ title: string; subtitle: string; body: string }>);
vi.mock('../../src/monitoring/desktop-notifier.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/monitoring/desktop-notifier.js')>()),
  notifyDesktop: (notice: { title: string; subtitle: string; body: string }) => {
    said.push(notice);
    return true;
  },
}));

const { AlertService } = await import('../../src/services/alert.service.js');
const { appleScriptString, notifyDesktop } = await vi.importActual<
  typeof import('../../src/monitoring/desktop-notifier.js')
>('../../src/monitoring/desktop-notifier.js');

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

/** A master with one rule over one app, and — when given — the rule's firing event. */
function masterWith(severity: string, app: { status: string }, firing?: { id: string }) {
  const rule = {
    id: 'r1',
    name: 'App crashed',
    expression: 'app.*.status == crashed',
    severity,
    forDuration: null,
    enabled: true,
    annotations: { summary: 'An app crashed' },
  };
  const chain: any = {
    selectAll: () => chain,
    where: () => chain,
    set: () => chain,
    values: () => chain,
    execute: async () => [rule],
    executeTakeFirst: async () => firing,
  };
  const db = { selectFrom: () => chain, updateTable: () => chain, insertInto: () => chain };
  const apps = [{ name: 'daos/dev/main', cpu: 1, memory: 1, ...app }];
  return new AlertService({ logger } as never, db as never, { list: () => apps } as never);
}

beforeEach(() => {
  said.length = 0;
});

describe('a critical alert', () => {
  it('is said once when it fires — with what fired and why it matters', async () => {
    await masterWith('critical', { status: 'crashed' }).evaluate();

    expect(said).toEqual([
      { title: 'omnitron — critical', subtitle: 'App crashed', body: 'daos/dev/main=crashed · An app crashed' },
    ]);
  });

  it('is not said again while it keeps firing', async () => {
    await masterWith('critical', { status: 'crashed' }, { id: 'e1' }).evaluate();

    expect(said).toEqual([]);
  });

  it('is said when it resolves', async () => {
    await masterWith('critical', { status: 'online' }, { id: 'e1' }).evaluate();

    expect(said).toEqual([
      { title: 'omnitron — resolved', subtitle: 'App crashed', body: 'The condition no longer holds.' },
    ]);
  });
});

describe('a warning', () => {
  it('stays in the console', async () => {
    await masterWith('warning', { status: 'crashed' }).evaluate();
    await masterWith('warning', { status: 'online' }, { id: 'e1' }).evaluate();

    expect(said).toEqual([]);
  });
});

describe('the words', () => {
  it('are one AppleScript string each — a quote in them ends nothing', () => {
    expect(appleScriptString('a "quoted" \\ name')).toBe('"a \\"quoted\\" \\\\ name"');
    expect(appleScriptString('two\nlines')).toBe('"two lines"');

    const hostile = appleScriptString('x" & (do shell script "id") & "');
    // Every quote inside is escaped: the literal opens once and closes once.
    expect(hostile.slice(1, -1)).not.toMatch(/(^|[^\\])"/);
  });

  it('go to osascript without a shell, on macOS only', () => {
    const run = vi.fn();
    const notice = { title: 'omnitron — critical', subtitle: 'Disk space below 50 GiB', body: '21.0 GiB free' };

    expect(notifyDesktop(notice, vi.fn(), { platform: 'linux', run })).toBe(false);
    expect(run).not.toHaveBeenCalled();

    expect(notifyDesktop(notice, vi.fn(), { platform: 'darwin', run })).toBe(true);
    expect(run).toHaveBeenCalledWith(
      'osascript',
      [
        '-e',
        'display notification "21.0 GiB free" with title "omnitron — critical" subtitle "Disk space below 50 GiB"',
      ],
      { timeout: 10_000 },
      expect.any(Function)
    );
  });

  it('and under the test runner, by default, nothing is said — a court’s «App crashed» is not the platform’s', () => {
    expect(process.env['NODE_ENV']).toBe('test');
    expect(notifyDesktop({ title: 't', subtitle: 's', body: 'b' }, vi.fn())).toBe(false);
  });

  it('and a failure to say it is logged, not thrown', () => {
    const onError = vi.fn();
    notifyDesktop({ title: 't', subtitle: 's', body: 'b' }, onError, {
      platform: 'darwin',
      run: (_f, _a, _o, done) => done(new Error('osascript: not allowed')),
    });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'osascript: not allowed' }));
  });
});
