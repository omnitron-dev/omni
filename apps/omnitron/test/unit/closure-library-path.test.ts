import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  closureLibraryDirectories,
  mergeLibraryPath,
  withClosureLibraryPath,
} from '../../src/release/closure-library-path.js';
import { loadBootstrapConfig } from '../../src/orchestrator/bootstrap-loader.js';
import { executeLocalMigration, prepareRemoteMigration } from '../../src/services/migration-process.js';

const cleanup: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const dir of cleanup.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  cleanup.push(dir);
  return dir;
}

describe('closure-library-path', () => {
  it('does not borrow an ancestor closure for a dependency-free verified release', async () => {
    const parent = await makeTempDir('omni-closure-parent-');
    const root = path.join(parent, 'installed-release');
    const external = path.join(parent, 'node_modules/.omnitron/0/lib');
    await fs.mkdir(root);
    await fs.mkdir(external, { recursive: true });
    await fs.writeFile(path.join(parent, '.omnitron-closure.json'), '{"protocol":1}');
    await fs.writeFile(path.join(root, '.omnitron-closure.json'), '{"protocol":1}');
    await fs.writeFile(path.join(external, 'libunverified.so'), 'elf');
    const env = { PORT: '3100' };
    expect(closureLibraryDirectories([root])).toEqual([external]);
    expect(closureLibraryDirectories({ verifiedRoot: root })).toEqual([]);
    expect(withClosureLibraryPath(env, { verifiedRoot: root }, {}, 'linux')).toBe(env);

    const own = path.join(root, 'node_modules/.omnitron/0/lib');
    await fs.mkdir(own, { recursive: true });
    await fs.writeFile(path.join(own, 'libverified.so'), 'elf');
    expect(withClosureLibraryPath(env, { verifiedRoot: root }, {}, 'linux')).toEqual({ ...env, LD_LIBRARY_PATH: own });
  });

  it('refuses a nonphysical verified root and a library directory that leaves it', async () => {
    const parent = await makeTempDir('omni-closure-boundary-');
    const root = path.join(parent, 'installed-release'), outside = path.join(parent, 'outside');
    await fs.mkdir(root);
    await fs.mkdir(outside);
    await fs.writeFile(path.join(root, '.omnitron-closure.json'), '{"protocol":1}');
    await fs.symlink(root, path.join(parent, 'alias'));
    expect(() => closureLibraryDirectories({ verifiedRoot: path.join(parent, 'alias') })).toThrow('physical absolute directory');
    await fs.symlink(outside, path.join(root, 'node_modules'));
    expect(() => closureLibraryDirectories({ verifiedRoot: root })).toThrow('library directory must be physical');
  });

  it.each(['LD_PRELOAD', 'LD_AUDIT', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES', 'DYLD_FRAMEWORK_PATH'])(
    'refuses explicit and inherited %s before platform or empty-closure shortcuts', async key => {
      const root = await makeTempDir('omni-closure-environment-');
      await fs.writeFile(path.join(root, '.omnitron-closure.json'), '{"protocol":1}');
      for (const platform of ['linux', 'darwin'] as const) {
        expect(() => withClosureLibraryPath({ [key]: '/unverified' }, { verifiedRoot: root }, {}, platform)).toThrow(key);
        expect(() => withClosureLibraryPath({}, { verifiedRoot: root }, { [key]: '/unverified' }, platform)).toThrow(key);
      }
    });

  it('discovers shared-object directories inside .omnitron packages in deterministic index order', async () => {
    const root = await makeTempDir('omni-closure-libs-');
    const outside = await makeTempDir('omni-closure-outside-');
    await fs.writeFile(path.join(root, '.omnitron-closure.json'), '{"protocol":1}\n');
    await fs.mkdir(path.join(root, 'dist'), { recursive: true });
    await fs.writeFile(path.join(root, 'dist', 'bootstrap.js'), 'export default {};\n');

    // Numeric order: 2 before 10 before 332.
    await fs.mkdir(path.join(root, 'node_modules', '.omnitron', '332', 'lib'), { recursive: true });
    await fs.writeFile(path.join(root, 'node_modules', '.omnitron', '332', 'lib', 'libvips-cpp.so.8.18.7'), 'elf');

    await fs.mkdir(path.join(root, 'node_modules', '.omnitron', '2', 'vendor'), { recursive: true });
    await fs.writeFile(path.join(root, 'node_modules', '.omnitron', '2', 'vendor', 'libcodec.so'), 'elf');
    // Intra-closure symlink to a regular .so file in package 2.
    await fs.mkdir(path.join(root, 'node_modules', '.omnitron', '10', 'lib'), { recursive: true });
    await fs.symlink(
      path.join(root, 'node_modules', '.omnitron', '2', 'vendor', 'libcodec.so'),
      path.join(root, 'node_modules', '.omnitron', '10', 'lib', 'libcodec.so.1')
    );

    // Non-.so native addons (.node) and JS files must not add directories.
    await fs.mkdir(path.join(root, 'node_modules', '.omnitron', '333', 'lib'), { recursive: true });
    await fs.writeFile(path.join(root, 'node_modules', '.omnitron', '333', 'lib', 'sharp-linux-x64.node'), 'elf');
    await fs.writeFile(path.join(root, 'node_modules', '.omnitron', '333', 'lib', 'helper.so.js'), '');

    // Nested node_modules symlinks and escaping symlinks must never be followed.
    await fs.writeFile(path.join(outside, 'libescape.so.1'), 'outside');
    await fs.mkdir(path.join(root, 'node_modules', '.omnitron', '99', 'lib'), { recursive: true });
    await fs.symlink(
      path.join(outside, 'libescape.so.1'),
      path.join(root, 'node_modules', '.omnitron', '99', 'lib', 'libescape.so.1')
    );
    await fs.mkdir(path.join(root, 'node_modules', '.omnitron', '333', 'node_modules', '@img'), { recursive: true });
    await fs.symlink(
      '../../../332',
      path.join(root, 'node_modules', '.omnitron', '333', 'node_modules', '@img', 'sharp-libvips-linux-x64')
    );

    expect(closureLibraryDirectories([path.join(root, 'dist', 'bootstrap.js')])).toEqual([
      path.join(root, 'node_modules', '.omnitron', '2', 'vendor'),
      path.join(root, 'node_modules', '.omnitron', '10', 'lib'),
      path.join(root, 'node_modules', '.omnitron', '332', 'lib'),
    ]);
    // Strict admission must report the escaping library even when a valid
    // regular library sorts earlier in the same directory.
    const escaped = path.join(root, 'node_modules', '.omnitron', '99', 'lib', 'libescape.so.1');
    await fs.writeFile(path.join(path.dirname(escaped), 'a-valid.so'), 'elf');
    expect(() => closureLibraryDirectories({ verifiedRoot: root })).toThrow('library leaves its root');
    await fs.unlink(escaped);
    expect(closureLibraryDirectories({ verifiedRoot: root })).toEqual([
      path.join(root, 'node_modules', '.omnitron', '2', 'vendor'),
      path.join(root, 'node_modules', '.omnitron', '10', 'lib'),
      path.join(root, 'node_modules', '.omnitron', '99', 'lib'),
      path.join(root, 'node_modules', '.omnitron', '332', 'lib'),
    ]);
  });

  it('leaves caller environment untouched on non-Linux hosts or closures without shared objects', async () => {
    const root = await makeTempDir('omni-closure-empty-');
    await fs.writeFile(path.join(root, '.omnitron-closure.json'), '{"protocol":1}\n');
    await fs.mkdir(path.join(root, 'node_modules', '.omnitron', '1', 'dist'), { recursive: true });
    await fs.writeFile(path.join(root, 'node_modules', '.omnitron', '1', 'dist', 'index.js'), '');

    const original = { PORT: '3100' };
    expect(withClosureLibraryPath(original, [root], {}, 'linux')).toBe(original);
    expect(withClosureLibraryPath(undefined, [root], {}, 'linux')).toBeUndefined();

    await fs.mkdir(path.join(root, 'node_modules', '.omnitron', '2', 'lib'), { recursive: true });
    await fs.writeFile(path.join(root, 'node_modules', '.omnitron', '2', 'lib', 'libvips-cpp.so.8.18.7'), 'elf');

    expect(withClosureLibraryPath(original, [root], {}, 'darwin')).toBe(original);
    const linuxEnv = withClosureLibraryPath(
      { ...original, LD_LIBRARY_PATH: '/app/custom:/usr/local/lib' },
      [root],
      { LD_LIBRARY_PATH: '/usr/local/lib:/opt/host/lib' },
      'linux'
    );
    expect(original).toEqual({ PORT: '3100' });
    expect(linuxEnv).toEqual({
      PORT: '3100',
      LD_LIBRARY_PATH: [
        path.join(root, 'node_modules', '.omnitron', '2', 'lib'),
        '/app/custom',
        '/usr/local/lib',
        '/opt/host/lib',
      ].join(':'),
    });
    expect(mergeLibraryPath([], undefined, '')).toBeUndefined();
  });

  it('propagates packaged .so directories into remote and local sealed migrations on Linux', async () => {
    const root = await makeTempDir('omni-closure-mig-');
    await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}\n');
    await fs.writeFile(path.join(root, '.omnitron-closure.json'), '{"protocol":1}\n');
    const libDir = path.join(root, 'node_modules', '.omnitron', '5', 'lib');
    await fs.mkdir(libDir, { recursive: true });
    await fs.writeFile(path.join(libDir, 'libvips-cpp.so.8.18.7'), 'elf');
    const script = path.join(root, 'dist', 'migrate.js');
    await fs.mkdir(path.dirname(script), { recursive: true });
    await fs.writeFile(script, `console.log(JSON.stringify({ ld: process.env.LD_LIBRARY_PATH ?? null }));\n`);

    const local = await executeLocalMigration(
      {
        app: 'api',
        environmentApp: 'api',
        service: 'postgres',
        database: 'main',
        mode: 'script',
        source: 'src/migrate.ts',
        release: 'dist/migrate.js',
        script,
        cwd: root,
        sealed: true,
        nodeOptions: '',
      },
      {}
    );
    const localParsed = JSON.parse(local.stdout.trim()) as { ld: string | null };
    if (process.platform === 'linux') {
      expect(localParsed.ld).toBe(libDir);
    } else {
      expect(localParsed.ld).toBe(null);
    }

    const remote = prepareRemoteMigration(
      { cwd: root, script, node: process.execPath, verifiedRoot: root },
      {}
    );
    const remoteOut = execFileSync('/bin/sh', ['-c', remote.command], { input: remote.stdin, encoding: 'utf8' });
    const remoteParsed = JSON.parse(remoteOut.trim()) as { ld: string | null };
    if (process.platform === 'linux') {
      expect(remoteParsed.ld).toBe(libDir);
    } else {
      expect(remoteParsed.ld).toBe(null);
    }
  });

  it.each(['declared', 'inherited'])('refuses %s loader overrides before a sealed local migration starts', async mode => {
    const root = await makeTempDir('omni-local-migration-loader-');
    const script = path.join(root, 'migrate.mjs'), effect = path.join(root, 'effects');
    await fs.writeFile(path.join(root, '.omnitron-closure.json'), '{"protocol":1}');
    await fs.writeFile(script, `import fs from 'node:fs';fs.writeFileSync('effects','unexpected');`);
    if (mode === 'inherited') vi.stubEnv('LD_LIBRARY_PATH', '/unverified/libraries');
    await expect(executeLocalMigration({ app: 'api', environmentApp: 'api', service: 'postgres', database: 'main',
      mode: 'script', source: 'src/migrate.ts', release: 'migrate.mjs', script, cwd: root, sealed: true, nodeOptions: '' },
    mode === 'declared' ? { LD_LIBRARY_PATH: '/unverified/libraries' } : {})).rejects.toThrow('LD_LIBRARY_PATH');
    await expect(fs.stat(effect)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  const hasLinuxCompiler =
    process.platform === 'linux' && spawnSync('cc', ['--version'], { stdio: 'ignore' }).status === 0;

  it.skipIf(!hasLinuxCompiler)(
    'loads an ELF .node addon whose sibling .so lives in another .omnitron/<index>/lib directory',
    async () => {
      const root = await makeTempDir('omni-closure-dlopen-');
      await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}\n');
      await fs.writeFile(path.join(root, '.omnitron-closure.json'), '{"protocol":1}\n');

      const libPkgDir = path.join(root, 'node_modules', '.omnitron', '332', 'lib');
      const addonPkgDir = path.join(root, 'node_modules', '.omnitron', '333', 'lib');
      const srcDir = await makeTempDir('omni-closure-c-src-');
      await fs.mkdir(libPkgDir, { recursive: true });
      await fs.mkdir(addonPkgDir, { recursive: true });

      const libSrc = path.join(srcDir, 'probe_vips.c');
      const addonSrc = path.join(srcDir, 'probe_addon.c');
      await fs.writeFile(libSrc, 'int omnitron_closure_probe(void) { return 8187; }\n');
      await fs.writeFile(
        addonSrc,
        [
          'extern int omnitron_closure_probe(void);',
          'void* napi_register_module_v1(void* env, void* exports) {',
          '  (void)env;',
          '  return omnitron_closure_probe() == 8187 ? exports : 0;',
          '}',
          '',
        ].join('\n')
      );

      const soPath = path.join(libPkgDir, 'libomnitron_closure_probe.so.1');
      const soLink = path.join(srcDir, 'libomnitron_closure_probe.so');
      const addonPath = path.join(addonPkgDir, 'probe-linux.node');

      execFileSync('cc', ['-shared', '-fPIC', '-Wl,-soname,libomnitron_closure_probe.so.1', '-o', soPath, libSrc]);
      await fs.symlink(soPath, soLink);
      // Reproduce @img/sharp-linux-x64's exact broken sibling DT_RPATH inside .omnitron/<index>.
      execFileSync('cc', [
        '-shared',
        '-fPIC',
        `-Wl,--disable-new-dtags,-rpath,$ORIGIN/../../probe-libvips-linux/lib`,
        '-o',
        addonPath,
        addonSrc,
        `-L${srcDir}`,
        '-Wl,--no-as-needed',
        '-lomnitron_closure_probe',
      ]);

      // Without LD_LIBRARY_PATH, dlopen fails with ERR_DLOPEN_FAILED.
      const unpatched = spawnSync(
        process.execPath,
        [
          '-e',
          `import { createRequire } from 'node:module'; createRequire(import.meta.url)(${JSON.stringify(addonPath)});`,
        ],
        { encoding: 'utf8', env: { ...process.env, LD_LIBRARY_PATH: '' } }
      );
      expect(unpatched.status).not.toBe(0);
      expect(unpatched.stderr).toContain('libomnitron_closure_probe.so.1');

      // Through loadBootstrapConfig(..., { freshModuleGraph: true }), the reader child loads cleanly.
      const bootstrapPath = path.join(root, 'dist', 'bootstrap.js');
      await fs.mkdir(path.dirname(bootstrapPath), { recursive: true });
      await fs.writeFile(
        bootstrapPath,
        [
          "import { createRequire } from 'node:module';",
          `createRequire(import.meta.url)(${JSON.stringify(addonPath)});`,
          "export default { name: 'probe-api', version: '0.1.0', processes: [{ name: 'http', module: './app.js' }] };",
          '',
        ].join('\n')
      );

      const definition = await loadBootstrapConfig(bootstrapPath, { freshModuleGraph: true, releaseRoot: root });
      expect(definition.name).toBe('probe-api');
    }
  );
});
