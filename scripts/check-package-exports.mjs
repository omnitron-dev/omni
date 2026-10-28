#!/usr/bin/env node
/** Validate the public entry points of actual package archives after a build. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-pack-check-'));
const failures = [];
let packages = 0;
let targets = 0;
const strings = value => typeof value === 'string' ? [value]
  : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

try {
  for (const group of ['packages', 'apps']) {
    for (const entry of fs.readdirSync(path.join(root, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(root, group, entry.name);
      const source = path.join(directory, 'package.json');
      if (!fs.existsSync(source) || JSON.parse(fs.readFileSync(source, 'utf8')).private) continue;
      const packed = JSON.parse(execFileSync('pnpm', ['pack', '--json', '--pack-destination', temporary], {
        cwd: directory, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
      }));
      // Read the archive's manifest: publishConfig can change its entry points.
      const manifest = JSON.parse(execFileSync('tar', ['-xOf', packed.filename, 'package/package.json'], {
        encoding: 'utf8', maxBuffer: 1024 * 1024,
      }));
      const files = new Set(packed.files.map(file => file.path));
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
      fs.rmSync(packed.filename);
    }
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`${packages} package archives, ${targets} public targets: all files present`);
}
