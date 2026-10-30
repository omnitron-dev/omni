#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { publishConsole, stampConsole } from './console-publication.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const webapp = path.resolve(here, '../webapp');
const require = createRequire(path.join(webapp, 'package.json'));
const [flag, value, ...extra] = process.argv.slice(2);
if (extra.length || (flag && (!['--out-dir', '--publish-from'].includes(flag) || !value)))
  throw new Error('Usage: build-console.mjs [--out-dir <directory> | --publish-from <directory>]');
const run = (entry, args) => execFileSync(process.execPath, [entry, ...args], { cwd: webapp, stdio: 'inherit', timeout: 300_000 });
if (flag === '--publish-from') {
  console.log(publishConsole(value, path.join(webapp, 'dist')));
} else {
  const stage = fs.mkdtempSync(path.join(webapp, 'node_modules/.console-build-'));
  try {
    run(require.resolve('typescript/lib/tsc.js'), ['--noEmit', '--incremental', 'false']);
    const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
    run(vite, ['build', '--outDir', stage]);
    stampConsole(stage);
    run(path.join(here, 'stamp-build.mjs'), [stage]);
    if (flag === '--out-dir') {
      if (fs.existsSync(value)) throw new Error(`Output already exists: ${value}`);
      fs.cpSync(stage, value, { recursive: true, errorOnExist: true, force: false });
    } else console.log(publishConsole(stage, path.join(webapp, 'dist')));
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
