/**
 * A build root nobody removed.
 *
 * 2026-09-25, the host volume at 100 % and Postgres fsyncing one file in up
 * to 29 s: `omnitron release prune --keep 10 --yes` said «Removed 44
 * release(s), 2001.9 MB freed» and the release store went from 14 GB to
 * 580 MB. Six of the 44 were builds that never finished, each still holding
 * `src/` — two clones with their `node_modules`, 1.3–2.2 GB apiece. The
 * builder left the root after a throw «because a failed build is evidence»,
 * a killed build left it because nothing ran at all, nothing removed either
 * afterwards, and the prune that did remove them did not count them.
 *
 * Held here:
 *   - a build that throws once it has a root takes that root's `src/` with
 *     it — the logs stay — unless `--keep-source`;
 *   - `release build` stops on SIGINT/SIGTERM the way a build stops (its
 *     signal aborted, so the throw above runs) rather than the way a killed
 *     process does, and exits 130/143;
 *   - `release prune` says how many build roots it takes, and that their
 *     size is not in the number it prints.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'build-root-court-')));
const ROOT = path.join(HOME, 'releases');
afterAll(() => fs.rmSync(HOME, { recursive: true, force: true }));

vi.mock('../../src/config/defaults.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/defaults.js')>();
  return { ...actual, OMNITRON_HOME: HOME };
});

vi.mock('../../src/daemon/daemon-client.js', () => ({
  LONG_REQUEST_TIMEOUT: 600_000,
  createDaemonClient: () => ({
    whyUnreachable: async () => null,
    service: async (name: string) => {
      if (name === 'OmnitronAudit') return { available: async () => ({ available: true }) };
      if (name === 'OmnitronRelease') return { deployments: async () => [] };
      throw new Error(`Service '${name}' is not exposed`);
    },
    disconnect: async () => {},
  }),
}));

/** The builder as the CLI sees it: waits until its signal aborts, then throws as a stopped build does. */
const build = { seen: null as AbortSignal | null };
vi.mock('../../src/release/build-run.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/release/build-run.js')>();
  return {
    ...actual,
    runReleaseBuild: vi.fn(async (_project: string, options: { signal?: AbortSignal }) => {
      build.seen = options.signal ?? null;
      await new Promise<void>((_, reject) => {
        options.signal?.addEventListener('abort', () => reject(new Error('The build was stopped')), { once: true });
      });
      throw new Error('unreachable');
    }),
  };
});

const said: string[] = [];
vi.mock('@xec-sh/kit', () => ({
  log: Object.fromEntries(['info', 'success', 'warn', 'error', 'step', 'message'].map((level) => [level, (m: unknown) => said.push(String(m))])),
  table: () => undefined,
  prism: new Proxy({}, { get: () => (s: string) => s }),
}));

const { withBuildRootGoneOnFailure } = await import('../../src/release/build-run.js');
const { releaseBuildCommand, releasePruneCommand } = await import('../../src/commands/release.js');

function rootWith(parts: { src?: boolean; logs?: boolean }): string {
  const root = fs.mkdtempSync(path.join(HOME, 'root-'));
  if (parts.src) {
    fs.mkdirSync(path.join(root, 'src', 'omni', 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'omni', 'node_modules', 'x.js'), 'x');
  }
  if (parts.logs) {
    fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'logs', 'install.log'), 'ERR_PNPM_FETCH_404\n');
  }
  return root;
}

describe('a build that throws takes its build root with it', () => {
  it('removes src/ and leaves the logs', async () => {
    const root = rootWith({ src: true, logs: true });
    await expect(
      withBuildRootGoneOnFailure(undefined, async (where) => {
        where.root = root;
        throw new Error('install failed — logs/install.log');
      }),
    ).rejects.toThrow(/install failed/);
    expect(fs.existsSync(path.join(root, 'src'))).toBe(false);
    expect(fs.readFileSync(path.join(root, 'logs', 'install.log'), 'utf8')).toContain('ERR_PNPM_FETCH_404');
  });

  it('keeps src/ for the one who asked to look inside (--keep-source)', async () => {
    const root = rootWith({ src: true, logs: true });
    await expect(
      withBuildRootGoneOnFailure(true, async (where) => {
        where.root = root;
        throw new Error('gates runner crashed');
      }),
    ).rejects.toThrow(/gates runner crashed/);
    expect(fs.existsSync(path.join(root, 'src', 'omni', 'node_modules', 'x.js'))).toBe(true);
  });

  it('touches nothing when it threw before it had a root, and nothing when it succeeded', async () => {
    const root = rootWith({ src: true });
    await expect(withBuildRootGoneOnFailure(undefined, async () => Promise.reject(new Error('no project')))).rejects.toThrow(
      /no project/,
    );
    expect(await withBuildRootGoneOnFailure(undefined, async (where) => ((where.root = root), 'built'))).toBe('built');
    expect(fs.existsSync(path.join(root, 'src'))).toBe(true);
  });
});

describe('release build stops on a signal the way a build stops', () => {
  let handlers: Map<string, (sig: NodeJS.Signals) => void>;
  beforeEach(() => {
    handlers = new Map();
    said.length = 0;
    build.seen = null;
    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: (sig: NodeJS.Signals) => void) => {
      handlers.set(event, handler);
      return process;
    }) as never);
    vi.spyOn(process, 'off').mockImplementation(((event: string) => {
      handlers.delete(event);
      return process;
    }) as never);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  it('aborts the build on SIGINT, exits 130, and lets go of both handlers', async () => {
    const run = releaseBuildCommand('daos', {});
    await vi.waitFor(() => expect(build.seen).not.toBeNull());
    expect([...handlers.keys()].sort()).toEqual(['SIGINT', 'SIGTERM']);
    handlers.get('SIGINT')!('SIGINT');
    await run;
    expect(build.seen!.aborted).toBe(true);
    expect(process.exitCode).toBe(130);
    expect(handlers.size).toBe(0);
    expect(said.join('\n')).toMatch(/SIGINT — stopping the build/);
  });

  it('exits 143 on SIGTERM — what `timeout` sends', async () => {
    const run = releaseBuildCommand('daos', {});
    await vi.waitFor(() => expect(build.seen).not.toBeNull());
    handlers.get('SIGTERM')!('SIGTERM');
    await run;
    expect(process.exitCode).toBe(143);
  });
});

describe('release prune says what it cannot measure', () => {
  beforeEach(() => {
    said.length = 0;
    fs.rmSync(ROOT, { recursive: true, force: true });
    fs.mkdirSync(ROOT, { recursive: true });
  });
  afterEach(() => {
    process.exitCode = 0;
  });

  function release(id: string, withSource: boolean): void {
    const dir = path.join(ROOT, id);
    fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'logs', 'clone.log'), 'cloned\n');
    if (withSource) {
      fs.mkdirSync(path.join(dir, 'src', 'daos'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src', 'daos', 'big'), Buffer.alloc(64 * 1024));
    }
  }

  it('names each build root it would take, and says their size is not in the total', async () => {
    release('daos-202609241126-ba44747f-da221d42', true);
    release('daos-202609241134-b13f9bb3-da221d42', false);
    release('daos-202609242117-b976c0a5-d6628e81', false);
    await releasePruneCommand({ keep: 1 });
    const out = said.join('\n');
    expect(out).toMatch(/would remove daos-202609241126-ba44747f-da221d42 \([^)]*\+ a build root, not measured\)/);
    expect(out).toMatch(/would remove daos-202609241134-b13f9bb3-da221d42 \([^)+]*\)/);
    expect(out).toMatch(/plus 1 build root\(s\) of builds that did not finish — not in that size/);
  });
});
