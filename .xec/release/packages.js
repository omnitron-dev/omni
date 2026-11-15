/** Validate the public entry points of actual package archives after a build. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Pipeline } from '@xec-sh/ops/pipeline';
import { releaseCommand, verifyReleaseArtifact, validatePackedPackage } from '@xec-sh/ops/release';
import semver from 'semver';
import { assertConsumerArchives, inlinedDevDependencies, retainedBuildImports, workspaceReferenceFindings } from '../../scripts/lib/package-imports.mjs';
import { assertPipelineSucceeded } from '../../scripts/lib/pipeline-result.mjs';

/** Consumer acceptance never builds or packs: it consumes this exact immutable batch. */
export async function checkPackageArchives(root, artifacts, { consumer, run = releaseCommand, signal, env } = {}) {
  const execute = (cwd, command, args, options) => run(cwd, command, args, { signal, envMode: 'replace', env: env ?? process.env, ...options });
  const selected = new Map(artifacts.map(artifact => [artifact.name, artifact]));
  if (selected.size !== artifacts.length) throw new Error('Duplicate archive identity');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-pack-check-'));
  const archives = new Map();
  const failures = [];
  let packages = 0;
  let targets = 0;
  const strings = value => typeof value === 'string' ? [value]
    : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function prepareConsumer(destination, roots) {
    const consumer = path.resolve(destination);
    fs.mkdirSync(consumer);
    fs.mkdirSync(path.join(consumer, 'archives'));
    const dependencies = {};
    function include(name) {
      if (dependencies[name] || !archives.has(name)) return;
      const { manifest, filename } = archives.get(name);
      const relative = 'archives/' + path.basename(filename);
      dependencies[name] = 'file:./' + relative;
      fs.copyFileSync(filename, path.join(consumer, relative));
      for (const dependency of Object.keys({
        ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies,
      })) include(dependency);
    }
    for (const name of roots) {
      if (!archives.has(name)) throw new Error('Required public package is absent: ' + name);
      include(name);
    }
    fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ private: true, dependencies }));
  }

  async function verifyConsumers(runtime) {
    const lumen = path.join(temporary, 'lumen-runtime');
    const profiles = [
      { name: 'runtime', cwd: runtime, roots: ['@omnitron-dev/omnitron', '@omnitron-dev/netron-react'] },
      { name: 'all-public', cwd: path.join(temporary, 'all-public'), roots: archives.keys() },
      { name: 'lumen', cwd: lumen, roots: ['@omnitron-dev/lumen'] },
    ];
    const pipeline = Pipeline.create('npm-consumers');
    for (const { name, cwd, roots } of profiles) {
      prepareConsumer(cwd, roots);
      const npm = (args) => ({ command: 'npm', args: [...args, '--omit=dev', '--registry=https://registry.npmjs.org/'], cwd, shell: false, env: env ?? process.env, envMode: 'replace' });
      // Exercise ordinary installation on the minimal runtime. The other profiles
      // resolve fresh locks, then install and run their scripts once through npm ci.
      const install = name === 'runtime' ? ['install'] : ['install', '--package-lock-only', '--ignore-scripts'];
      pipeline.step(name + '-resolve', { run: npm([...install, '--no-audit', '--no-fund']), timeout: 20 * 60_000 });
      if (name !== 'runtime') pipeline.step(name + '-install', {
        dependsOn: [name + '-resolve'], run: npm(['ci', '--no-audit', '--no-fund']), timeout: 30 * 60_000,
      });
      pipeline.step(name + '-integrity', { dependsOn: [name + (name === 'runtime' ? '-resolve' : '-install')], run: async () => {
          const verified = assertConsumerArchives(cwd, archives);
          console.log(`npm consumer ${name}: ${verified} installed SDK archives verified`);
        } })
        .step(name + '-audit', { dependsOn: [name + '-integrity'], run: npm(['audit', '--audit-level=low']), timeout: 5 * 60_000 });
    }
    const result = await pipeline.run({}, { signal, concurrency: 2, onEvent(event) {
      if (event.type === 'step-start') console.log('npm consumer ' + event.step);
      if (event.type === 'step-output') process[event.stream].write(event.text);
    } });
    assertPipelineSucceeded(result);
    return lumen;
  }

  try {
    const workspaces = [];
    for (const group of ['packages', 'apps']) {
      for (const entry of fs.readdirSync(path.join(root, group), { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const directory = path.join(root, group, entry.name);
        const source = path.join(directory, 'package.json');
        if (fs.existsSync(source)) workspaces.push({ directory, source, workspace: JSON.parse(fs.readFileSync(source, 'utf8')) });
      }
    }
    const workspaceNames = new Set(workspaces.map(({ workspace }) => workspace.name));
    const invalidReferences = workspaces.flatMap(({ workspace }) =>
      workspaceReferenceFindings(workspace, workspaceNames).map(finding => `${workspace.name}: ${finding}`));
    if (invalidReferences.length) throw new Error('Invalid workspace references:\n' + invalidReferences.join('\n'));
    for (const { directory, source, workspace } of workspaces) {
      if (workspace.private) continue;
      const artifact = selected.get(workspace.name);
      if (!artifact || artifact.version !== workspace.version) throw new Error('Archive inventory differs: ' + workspace.name);
      await verifyReleaseArtifact(artifact);
      const manifest = await validatePackedPackage(root, artifact.file, artifact, execute);
      if (!manifest) throw new Error('Archive consumer verification requires the published @xec-sh/ops 0.13 metadata API');
      const packed = { filename: artifact.file };
      // Read the selected archive, never another workspace pack.
      const files = new Set((await execute(root, 'tar', ['-tzf', packed.filename])).split(/\r?\n/)
        .filter(file => file && !file.endsWith('/')).map(file => file.replace(/^package\//, '')));
      const inlined = inlinedDevDependencies(workspace);
      const prism = manifest.name === '@omnitron-dev/prism';
      if (inlined.size || prism) {
        const unpacked = fs.mkdtempSync(path.join(temporary, 'archive-'));
        await execute(root, 'tar', ['-xf', packed.filename, '-C', unpacked]);
        const packageDir = path.join(unpacked, 'package');
        if (inlined.size) {
          for (const finding of retainedBuildImports(packageDir, files, inlined)) {
            failures.push(`${manifest.name}: inlined build dependency escaped: ${finding}`);
          }
        }
        if (prism) await checkPrismConsumer(unpacked, packageDir, directory);
      }
      if (['@omnitron-dev/netron-react', '@omnitron-dev/prism'].includes(manifest.name)) {
        for (const [subpath, conditions] of Object.entries(manifest.exports)) {
          const client = manifest.name === '@omnitron-dev/netron-react'
            ? ['.', './hooks', './auth', './test'].includes(subpath)
            : !['./http', './cli'].includes(subpath);
          for (const target of strings(conditions).filter(file => /\.(?:cjs|mjs|js)$/.test(file))) {
            const source = await execute(root, 'tar', ['-xOf', packed.filename, 'package/' + target.slice(2)]);
            const hasDirective = /^(?:['"]use strict['"];\s*)?['"]use client['"];/.test(source.trimStart());
            if (hasDirective !== client) failures.push(`${manifest.name}${subpath.slice(1)}: incorrect React boundary in ${target}`);
          }
        }
      }
      if (manifest.engines?.node) {
        const minimum = semver.minVersion(manifest.engines.node);
        const resolver = createRequire(source);
        for (const dependency of Object.keys(manifest.dependencies ?? {})) {
          // Follow Node's search order for either isolated or hoisted installs.
          // Resolving the manifest directly would require a package.json export.
          const installed = resolver.resolve.paths(`${dependency}/package.json`)
            .map(base => path.join(base, dependency, 'package.json')).find(file => fs.existsSync(file));
          if (!installed) throw new Error(`${manifest.name}: installed dependency is absent: ${dependency}`);
          const required = JSON.parse(fs.readFileSync(installed, 'utf8')).engines?.node;
          if (required && !semver.satisfies(minimum, required)) {
            failures.push(`${manifest.name}: Node ${minimum} is below the requirement of ${dependency} (${required})`);
          }
        }
      }
      const publicTargets = [...new Set([
        ...strings(manifest.exports), ...strings(manifest.bin),
        manifest.main, manifest.module, manifest.types, manifest.typings,
      ].filter(Boolean))];
      for (const target of publicTargets) {
        targets++;
        const normalized = target.replace(/^\.\//, '');
        const pattern = new RegExp('^' + normalized.split('*').map(escape).join('.*') + '$');
        if (path.isAbsolute(normalized) || normalized.split('/').includes('..') ||
            ![...files].some(file => pattern.test(file))) {
          failures.push(`${manifest.name}: exported file is absent from the archive: ${target}`);
        }
      }
      packages++;
      archives.set(manifest.name, { manifest, filename: packed.filename });
    }
    if (packages !== selected.size) throw new Error('Archive inventory contains unexpected packages');
    if (!failures.length && consumer) {
      const lumenConsumer = await verifyConsumers(consumer);
      await execute(root, process.execPath, [path.join(root, 'packages/lumen-ast/test/runtime/bundle-consumer.js'), lumenConsumer]);
      const consumerEnv = { ...(env ?? process.env), LUMEN_CONSUMER_ROOT: lumenConsumer };
      // Reuse the official-client, native SSR and real-browser suites against this installation.
      // Fixtures are copied into the consumer; no source/dist aliases satisfy imports.
      await execute(path.join(root, 'packages/lumen'), 'pnpm', ['exec', 'vitest', 'run', 'tests/mcp-stdio.test.ts', 'tests/ssr-consumer-peers.test.ts', '--maxWorkers', '1',
        '--no-cache', '--fsModuleCachePath', path.join(temporary, 'mcp-cache')], {
        env: consumerEnv, timeoutMs: 120_000,
      });
      const browserCwd = path.join(root, 'packages/lumen-ui');
      await execute(browserCwd, 'pnpm', ['exec', 'playwright', 'install', '--only-shell', 'chromium'], { timeoutMs: 300_000 });
      await execute(browserCwd, 'pnpm', ['run', 'test:browser', '--output', path.join(temporary, 'browser-results')], { env: consumerEnv, timeoutMs: 300_000 });
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }

  async function checkPrismConsumer(unpacked, packageDir, directory) {
    // CSS @imports need the package's declared peers. All Prism code and styles
    // still come from the archive. Inspect the archive before adding these links.
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(unpacked, 'node_modules'), 'dir');
    if (fs.existsSync(path.join(directory, 'node_modules'))) {
      fs.symlinkSync(path.join(directory, 'node_modules'), path.join(packageDir, 'node_modules'), 'dir');
    }
    await execute(root, process.execPath, [path.join(directory, 'test/runtime/bundle-consumer.mjs'), packageDir]);
  }
  if (failures.length) {
    throw new Error(failures.join('\n'));
  } else {
    console.log(`${packages} package archives, ${targets} public targets: all files present`);
  }

}
