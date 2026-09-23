/**
 * `omnitron project list` printed two projects under one path.
 *
 * The Path column is 50 wide and the table cuts a cell on the right.
 * Measured 2026-09-23 on the development master:
 *
 *     │ daos      │ /Users/taaliman/projects/luxquant/omnitron-dev/... │
 *     │ omnitron  │ /Users/taaliman/projects/luxquant/omnitron-dev/... │
 *
 * — `…/omni/internal/daos` and `…/omni/apps/omnitron`, 65 characters each
 * with the first 52 shared, so the 47 the column kept were the same 47. The
 * part that tells two projects apart is the end, and that is the part cut.
 *
 * The table is rendered here by the real `@xec-sh/kit`, because that is
 * where the cut happens: a check on the rows handed to it would pass with the
 * defect in place.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const answer = vi.hoisted(() => ({ projects: [] as unknown[], fail: null as Error | null }));

vi.mock('../../src/daemon/daemon-client.js', () => ({
  createDaemonClient: () => ({
    isReachable: async () => true,
    service: async () => ({
      listProjects: async () => {
        if (answer.fail) throw answer.fail;
        return answer.projects;
      },
      addProject: async () => {
        if (answer.fail) throw answer.fail;
        return answer.projects[0];
      },
      removeProject: async () => {
        if (answer.fail) throw answer.fail;
        return { success: true };
      },
    }),
    disconnect: async () => undefined,
  }),
}));

const { projectListCommand, projectAddCommand, displayPath } = await import('../../src/commands/project.js');

const project = (name: string, path: string) => ({
  name,
  displayName: name,
  path,
  registeredAt: '2026-09-05T13:53:45.663Z',
  enabledStacks: [],
  runningStacks: 0,
  totalStacks: 0,
});

/** Everything written to stdout while `run` runs. */
async function printed(run: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  });
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  return chunks.join('');
}

/** The Path cell of the row that names `name`. */
function pathCell(output: string, name: string): string {
  const row = output.split('\n').find((l) => l.split('│')[1]?.trim() === name);
  expect(row, `a row for ${name}`).toBeTruthy();
  return row!.split('│')[2]!.trim();
}

let exitCodeBefore: typeof process.exitCode;
beforeEach(() => {
  answer.projects = [];
  answer.fail = null;
  exitCodeBefore = process.exitCode;
  process.exitCode = undefined;
});
afterEach(() => {
  process.exitCode = exitCodeBefore;
});

describe('project list', () => {
  it('prints two projects under two paths, each with the end that tells it apart', async () => {
    // A shared prefix longer than the column, outside any home directory, so
    // the outcome does not depend on the machine the court runs on.
    const shared = '/srv/omnitron-court/projects/luxquant/omnitron-dev/omni';
    answer.projects = [project('daos', `${shared}/internal/daos`), project('omnitron', `${shared}/apps/omnitron`)];

    const out = await printed(() => projectListCommand());
    const daos = pathCell(out, 'daos');
    const omnitron = pathCell(out, 'omnitron');

    expect(daos, 'the same string for two projects').not.toBe(omnitron);
    expect(daos.endsWith('/internal/daos')).toBe(true);
    expect(omnitron.endsWith('/apps/omnitron')).toBe(true);
  });

  it('exits 1 when the list cannot be had', async () => {
    answer.fail = new Error('the daemon refused');

    await printed(() => projectListCommand());

    expect(process.exitCode).toBe(1);
  });

  it('exits 1 when a registration fails', async () => {
    answer.fail = new Error("Project 'daos' already registered");

    await printed(() => projectAddCommand('daos', '/srv/daos'));

    expect(process.exitCode).toBe(1);
  });
});

describe('displayPath', () => {
  const home = '/Users/taaliman';
  const daos = '/Users/taaliman/projects/luxquant/omnitron-dev/omni/internal/daos';
  const omnitron = '/Users/taaliman/projects/luxquant/omnitron-dev/omni/apps/omnitron';

  it('the two measured paths: distinct, within the column, ending where they differ', () => {
    const a = displayPath(daos, 50, home);
    const b = displayPath(omnitron, 50, home);

    expect(a).toBe('.../luxquant/omnitron-dev/omni/internal/daos');
    expect(b).toBe('.../luxquant/omnitron-dev/omni/apps/omnitron');
    expect(a.length).toBeLessThanOrEqual(50);
    expect(b.length).toBeLessThanOrEqual(50);
  });

  it('shows the home directory as ~, and leaves a path that fits whole', () => {
    expect(displayPath('/Users/taaliman/projects/omni', 50, home)).toBe('~/projects/omni');
    expect(displayPath('/opt/daos', 50, home)).toBe('/opt/daos');
  });

  it('abbreviates the home directory only as a whole segment', () => {
    expect(displayPath('/Users/taaliman2/projects', 50, home)).toBe('/Users/taaliman2/projects');
  });

  it('keeps the end of a last segment wider than the column on its own', () => {
    const shown = displayPath(`/data/${'x'.repeat(60)}-tail`, 20, home);

    expect(shown.length).toBe(20);
    expect(shown.startsWith('...')).toBe(true);
    expect(shown.endsWith('-tail')).toBe(true);
  });
});
