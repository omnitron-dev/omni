/**
 * What `optional` on a config source is allowed to forgive.
 *
 * `loadFile` already answers absence: a missing file on an optional source
 * returns `{}` and never throws. So by the time an optional FILE source
 * reaches the loader's catch, the file EXISTS and something else went wrong —
 * unparseable content, an unsupported `format`, an unreadable file. All three
 * were skipped in silence.
 *
 * A typo in an optional YAML file therefore changed application behaviour with
 * no signal anywhere: the application booted on defaults, reported a
 * successful start, and the operator who had just edited that file had no way
 * to learn it was not being read. In this monorepo those files carry database
 * URLs, Redis database numbers and feature flags.
 *
 * The contract this pins: **`optional` means the source may be ABSENT. It does
 * not mean the source may be WRONG.** Absence is one of the answers the system
 * is designed to accept; corruption is a failure to obtain an answer at all,
 * and the two must not share a code path. Fail-fast on malformed configuration
 * is what this codebase already does elsewhere for settings that would
 * otherwise produce silently wrong behaviour.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ConfigLoaderService } from '../../../src/modules/config/config-loader.service.js';
import type { IFileConfigSource } from '../../../src/modules/config/types.js';

describe('optional config sources', () => {
  let loader: ConfigLoaderService;
  let tempDir: string;

  beforeEach(() => {
    loader = new ConfigLoaderService();
    tempDir = path.join(process.cwd(), 'packages/titan/test/modules/config/.temp-optional-test');
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
  });

  const file = (name: string, contents: string): string => {
    const p = path.join(tempDir, name);
    fs.writeFileSync(p, contents);
    return p;
  };

  it('skips an optional source that is absent', async () => {
    // The control. Absence is the case `optional` exists for, and it has to
    // keep working or the assertions below prove nothing.
    const source: IFileConfigSource = {
      type: 'file',
      path: path.join(tempDir, 'nothing-here.json'),
      optional: true,
    };

    await expect(loader.load([source])).resolves.toEqual({});
  });

  it('keeps loading the other sources when an optional one is absent', async () => {
    const present: IFileConfigSource = {
      type: 'file',
      path: file('present.json', JSON.stringify({ app: { port: 3000 } })),
      format: 'json',
    };
    const missing: IFileConfigSource = {
      type: 'file',
      path: path.join(tempDir, 'gone.json'),
      optional: true,
    };

    await expect(loader.load([present, missing])).resolves.toEqual({ app: { port: 3000 } });
  });

  it('refuses an optional file whose contents cannot be parsed', async () => {
    const source: IFileConfigSource = {
      type: 'file',
      path: file('broken.json', '{ "app": { "port": 3000 '),
      format: 'json',
      optional: true,
    };

    await expect(loader.load([source])).rejects.toThrow(/broken\.json/);
  });

  it('says the file is malformed rather than missing', async () => {
    // The operator has just edited this file. "could not be parsed" sends them
    // to the edit; "skipped" sends them nowhere.
    const source: IFileConfigSource = {
      type: 'file',
      path: file('broken.yaml', 'app:\n  port: 3000\n :\t- bad'),
      format: 'yaml',
      optional: true,
    };

    await expect(loader.load([source])).rejects.toThrow(/pars/i);
  });

  it('refuses an optional file in a format it cannot read', async () => {
    // An unsupported `format` is a mistake in the source declaration, not a
    // property of the environment. Skipping it means the file is never read on
    // any machine, forever.
    const source: IFileConfigSource = {
      type: 'file',
      path: file('config.conf', 'port = 3000'),
      format: 'toml' as IFileConfigSource['format'],
      optional: true,
    };

    // Named as what it is. Re-describing it as a parse failure would send the
    // reader looking for a syntax error in a file whose syntax is fine.
    await expect(loader.load([source])).rejects.toThrow(/Unsupported config file format: toml/);
    await expect(loader.load([source])).rejects.not.toThrow(/could not be parsed/);
  });

  it('refuses an optional file that exists and cannot be read', async () => {
    // Not absence: the path resolves, and the process cannot get at its
    // contents. Booting on defaults because of a permission or IO problem is
    // the same silence, reached by a different route.
    const asDirectory = path.join(tempDir, 'a-directory.json');
    fs.mkdirSync(asDirectory);

    const source: IFileConfigSource = {
      type: 'file',
      path: asDirectory,
      format: 'json',
      optional: true,
    };

    await expect(loader.load([source])).rejects.toThrow(/exists but could not be read/);
  });

  it('still refuses a required file that is absent', async () => {
    const source: IFileConfigSource = {
      type: 'file',
      path: path.join(tempDir, 'required.json'),
    };

    await expect(loader.load([source])).rejects.toThrow();
  });

  it('does not turn an absent optional source into a malformed one', async () => {
    // The distinction has to hold in both directions: widening the rejection
    // to every optional failure would make `optional` useless.
    const sources: IFileConfigSource[] = [
      { type: 'file', path: path.join(tempDir, 'a.json'), optional: true },
      { type: 'file', path: path.join(tempDir, 'b.yaml'), optional: true },
      { type: 'file', path: file('c.json', JSON.stringify({ ok: true })), format: 'json', optional: true },
    ];

    await expect(loader.load(sources)).resolves.toEqual({ ok: true });
  });
});

/**
 * An optional file that is MISSING must not be silent.
 *
 * `path.resolve` in the loader resolves a relative path against
 * `process.cwd()`, which is whatever spawned the process — so a config that
 * exists on disk can silently fail to load, and an absent file is then
 * indistinguishable from an empty one. Every consumer with a hardcoded fallback
 * keeps working; the one without goes quiet.
 *
 * That happened: six backends in one project ran without their config files
 * because the supervisor spawns workers with its own working directory, and the
 * only client with no fallback returned null for every price quote — which took
 * fiat-priced payments down and read as a missing setting.
 *
 * `optional` means "boot without it", not "say nothing".
 */
describe('a missing optional config file says so', () => {
  it('warns, naming the resolved path and the cwd that produced it', async () => {
    const loader = new ConfigLoaderService();
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')); };

    let result: Record<string, unknown>;
    try {
      result = await loader.load({
        type: 'file',
        path: 'no/such/config/default.json',
        optional: true,
      });
    } finally {
      console.warn = originalWarn;
    }

    expect(result, 'still boots').toEqual({});
    expect(warnings).toHaveLength(1);
    // The resolved path is the useful part: it shows that
    // `apps/x/config/default.json` became `<someone else's dir>/apps/x/...`.
    expect(warnings[0]).toContain('no/such/config/default.json');
    expect(warnings[0], 'the absolute path it actually looked at').toContain(process.cwd());
    expect(warnings[0]).toMatch(/not found/i);
  });

  it('stays silent when the optional file is there', async () => {
    const loader = new ConfigLoaderService();
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')); };

    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'titan-config-'));
    const file = path.join(dir, 'present.json');
    await fs.promises.writeFile(file, JSON.stringify({ services: { priceverse: { url: 'http://x' } } }));

    let result: Record<string, unknown>;
    try {
      result = await loader.load({ type: 'file', path: file, optional: true });
    } finally {
      console.warn = originalWarn;
      await fs.promises.rm(dir, { recursive: true, force: true });
    }

    expect(result).toEqual({ services: { priceverse: { url: 'http://x' } } });
    expect(warnings, 'a warning for a file that loaded would be noise').toHaveLength(0);
  });
});
