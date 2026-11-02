import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [directory, mode] = process.argv.slice(2);
if (!directory || (mode && mode !== '--expect-unsupported')) {
  throw new Error('Usage: node scripts/ci/check-runtime-consumer.mjs <npm-consumer-directory> [--expect-unsupported]');
}
const consumer = realpathSync(directory);
const require = createRequire(path.join(consumer, 'package.json'));
const entry = require.resolve('@omnitron-dev/omnitron');
assert.ok(entry.startsWith(path.join(consumer, 'node_modules') + path.sep), 'CLI must come from this npm install');
const pkg = path.dirname(path.dirname(entry));
const manifest = JSON.parse(readFileSync(path.join(pkg, 'package.json'), 'utf8'));
const cli = path.join(pkg, manifest.bin.omnitron);
const version = execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8', cwd: consumer }).trim();
assert.equal(version, manifest.version);

// Use public package resolution from both kinds of consumer. The CJS hook
// build requires the same ESM browser client that an ESM app imports.
for (const suffix of ['', '/hooks', '/auth', '/cache', '/devtools', '/test']) {
  assert.ok(Object.keys(require('@omnitron-dev/netron-react' + suffix)).length);
}
assert.ok(require('@omnitron-dev/netron-react/test').createTestClient());
execFileSync(process.execPath, ['--input-type=module', '--eval',
  "import { createTestClient } from '@omnitron-dev/netron-react/test'; createTestClient();",
], { cwd: consumer });
execFileSync(process.execPath, ['--conditions=react-server', '--input-type=module', '--eval',
  "import { hashQueryKey } from '@omnitron-dev/netron-react/cache'; hashQueryKey(['server']);",
], { cwd: consumer });

// Exercise the daemon's ordinary journal constructor. Importing the driver
// and invoking the CLI alone both succeed even on the incompatible ABI.
const { LogJournal } = await import(pathToFileURL(path.join(pkg, 'dist/monitoring/log-journal.js')).href);
const open = () => new LogJournal(':memory:');
if (mode === '--expect-unsupported') {
  assert.ok(Number(process.versions.napi) < 10);
  assert.throws(open, /SQLite requires Node-API 10/);
  console.log(`Node ${process.version}: unsupported SQLite runtime refused before native open`);
} else {
  const journal = open();
  try {
    journal.put('consumer', { text: 'npm smoke' });
    assert.equal(journal.stats().pending, 1);
    assert.equal(journal.stats().error, null);
  } finally {
    journal.close();
  }
  console.log(`Omnitron ${version}, Node ${process.version}, Node-API ${process.versions.napi}: SQLite journal write/read passed`);
}
