#!/usr/bin/env node
/** Validate the public entry points of actual package archives after a build. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import semver from 'semver';
import { assertConsumerArchives, inlinedDevDependencies, retainedBuildImports } from './lib/package-imports.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-pack-check-'));
const { values } = parseArgs({ options: { 'install-consumer': { type: 'string' } } });
const archives = new Map();
const failures = [];
let packages = 0;
let targets = 0;
const strings = value => typeof value === 'string' ? [value]
  : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function installConsumer(destination, roots) {
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
  execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/'], {
    cwd: consumer, stdio: 'inherit',
  });
  // npm install can accept a bundled tree with an unsatisfied dependency.
  // Replay the generated lockfile as a consumer's CI would.
  execFileSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/'], {
    cwd: consumer, stdio: 'inherit',
  });
  assertConsumerArchives(consumer, archives);
  // Workspace overrides are not inherited by published npm consumers. Audit
  // the actual installed archives, including bundled dependency trees.
  execFileSync('npm', ['audit', '--omit=dev', '--audit-level=low', '--registry=https://registry.npmjs.org/'], {
    cwd: consumer, stdio: 'inherit',
  });
}

try {
  for (const group of ['packages', 'apps']) {
    for (const entry of fs.readdirSync(path.join(root, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(root, group, entry.name);
      const source = path.join(directory, 'package.json');
      if (!fs.existsSync(source)) continue;
      const workspace = JSON.parse(fs.readFileSync(source, 'utf8'));
      if (workspace.private) continue;
      const packed = JSON.parse(execFileSync('pnpm', ['pack', '--json', '--pack-destination', temporary], {
        cwd: directory, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
      }));
      // Read the archive's manifest: publishConfig can change its entry points.
      const manifest = JSON.parse(execFileSync('tar', ['-xOf', packed.filename, 'package/package.json'], {
        encoding: 'utf8', maxBuffer: 1024 * 1024,
      }));
      const files = new Set(packed.files.map(file => file.path));
      const inlined = inlinedDevDependencies(workspace);
      const prism = manifest.name === '@omnitron-dev/prism';
      if (inlined.size || prism) {
        const unpacked = fs.mkdtempSync(path.join(temporary, 'archive-'));
        execFileSync('tar', ['-xf', packed.filename, '-C', unpacked]);
        const packageDir = path.join(unpacked, 'package');
        if (inlined.size) {
          for (const finding of retainedBuildImports(packageDir, files, inlined)) {
            failures.push(`${manifest.name}: inlined build dependency escaped: ${finding}`);
          }
        }
        if (prism) checkPrismConsumer(unpacked, packageDir, directory);
      }
      if (['@omnitron-dev/netron-react', '@omnitron-dev/prism'].includes(manifest.name)) {
        for (const [subpath, conditions] of Object.entries(manifest.exports)) {
          const client = manifest.name === '@omnitron-dev/netron-react'
            ? ['.', './hooks', './auth', './test'].includes(subpath)
            : !['./http', './cli'].includes(subpath);
          for (const target of strings(conditions).filter(file => /\.(?:cjs|mjs|js)$/.test(file))) {
            const source = execFileSync('tar', ['-xOf', packed.filename, 'package/' + target.slice(2)], { encoding: 'utf8' });
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
      if (values['install-consumer']) archives.set(manifest.name, { manifest, filename: packed.filename });
      else fs.rmSync(packed.filename);
    }
  }
  if (!failures.length && values['install-consumer']) {
    // Keep the runtime probe independent of optional packages: a full install
    // could hide an undeclared import. Audit the remaining public surface too.
    installConsumer(values['install-consumer'], ['@omnitron-dev/omnitron', '@omnitron-dev/netron-react']);
    const allPublic = path.join(temporary, 'all-public');
    installConsumer(allPublic, archives.keys());
    // Lumen must also work with only its declared dependency closure. An unrelated
    // public package in all-public must not satisfy an undeclared runtime import.
    const lumenConsumer = path.join(temporary, 'lumen-runtime');
    installConsumer(lumenConsumer, ['@omnitron-dev/lumen']);
    execFileSync(process.execPath, [
      path.join(root, 'packages/lumen-ast/test/runtime/bundle-consumer.js'), lumenConsumer,
    ], { stdio: 'inherit' });
    const consumerEnv = { ...process.env, LUMEN_CONSUMER_ROOT: lumenConsumer };
    // Reuse the official-client and real-browser suites against this installation.
    // Fixtures are copied into the consumer; no source/dist aliases satisfy imports.
    execFileSync('pnpm', ['exec', 'vitest', 'run', 'tests/mcp-stdio.test.ts', '--maxWorkers', '1',
      '--no-cache', '--fsModuleCachePath', path.join(temporary, 'mcp-cache')], {
      cwd: path.join(root, 'packages/lumen'), env: consumerEnv, stdio: 'inherit', timeout: 120_000,
    });
    const browserCwd = path.join(root, 'packages/lumen-ui');
    execFileSync('pnpm', ['exec', 'playwright', 'install', '--only-shell', 'chromium'], {
      cwd: browserCwd, stdio: 'inherit', timeout: 300_000,
    });
    execFileSync('pnpm', ['run', 'test:browser', '--output', path.join(temporary, 'browser-results')], {
      cwd: browserCwd, env: consumerEnv, stdio: 'inherit', timeout: 300_000,
    });
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

function checkPrismConsumer(unpacked, packageDir, directory) {
  // CSS @imports need the package's declared peers. All Prism code and styles
  // still come from the archive. Inspect the archive before adding these links.
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(unpacked, 'node_modules'), 'dir');
  if (fs.existsSync(path.join(directory, 'node_modules'))) {
    fs.symlinkSync(path.join(directory, 'node_modules'), path.join(packageDir, 'node_modules'), 'dir');
  }
  execFileSync(process.execPath, [
    path.join(directory, 'test/runtime/bundle-consumer.mjs'), packageDir,
  ], { stdio: 'inherit' });
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`${packages} package archives, ${targets} public targets: all files present`);
}
