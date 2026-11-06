// Test-fixture inputs only. No SDK import, process launch, database or native lifecycle.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

function record(value, allowed, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  assert.ok(Object.keys(value).every(key => allowed.includes(key)), `${label} has unsupported fields`);
}
function absolute(value, label) {
  // Fixture paths deliberately reject literal control bytes.
  assert.ok(typeof value === 'string' && path.isAbsolute(value) && path.resolve(value) === value && !/[\x00-\x1f\x7f]/.test(value), `${label} must be an absolute canonical path`);
  return value;
}
function sameFile(a, b) { return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs; }

export async function readMasterFixture(argv, env) {
  const options = ['--master-scenario', '--fixture-root', '--master-config'];
  if (!argv.includes(options[0])) {
    assert.ok(!options.slice(1).some(option => argv.includes(option)), 'Master options require --master-scenario');
    return undefined;
  }
  const positional = argv.slice(0, 2);
  assert.equal(positional.length, 2, 'Master fixture requires sealed and management dist');
  assert.ok(positional.every(value => !value.startsWith('--')), 'Master fixture requires two runtime paths');
  const values = {};
  for (let i = 2; i < argv.length; i += 2) {
    assert.ok(options.includes(argv[i]) && values[argv[i]] === undefined && argv[i + 1] && !argv[i + 1].startsWith('--'), 'Unsupported, duplicate or incomplete master fixture option');
    values[argv[i]] = argv[i + 1];
  }
  assert.ok(options.every(option => values[option]), 'All three master fixture options are required');
  const root = absolute(values['--fixture-root'], 'Fixture root');
  assert.equal(await fs.realpath(path.dirname(root)), path.dirname(root), 'Fixture parent must not traverse symlinks');
  await assert.rejects(fs.lstat(root), error => error.code === 'ENOENT', 'Fixture root must be absent');
  assert.ok(Buffer.byteLength(path.join(root, 'e', 'c-00000000-0000-0000-0000-000000000000.sock')) <= 100, 'Private control socket exceeds 100 bytes');
  const scenario = absolute(values['--master-scenario'], 'Scenario module');
  assert.equal(await fs.realpath(scenario), scenario, 'Scenario must not traverse symlinks');
  assert.ok((await fs.lstat(scenario)).isFile(), 'Scenario must be a regular file');
  const configPath = absolute(values['--master-config'], 'Master config');
  assert.equal(await fs.realpath(configPath), configPath, 'Master config must not traverse symlinks');
  const handle = await fs.open(configPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let raw;
  try {
    const before = await handle.stat();
    assert.ok(before.isFile() && before.uid === process.getuid() && (before.mode & 0o777) === 0o600 && before.nlink === 1 && before.size <= 1024 * 1024, 'Master config must be owned, private 0600, regular and bounded');
    raw = await handle.readFile('utf8');
    assert.ok(sameFile(before, await handle.stat()), 'Master config changed while reading');
  } finally { await handle.close(); }
  // JSON only; parse errors deliberately omit config text and credential values.
  let input;
  try { input = JSON.parse(raw); } catch { throw new Error('Master config must be valid JSON'); }
  record(input, ['role', 'initialized', 'initializedAt', 'webapp', 'host', 'advertiseHost', 'consoleBindHost', 'port', 'httpPort', 'cluster', 'executionHost', 'auth', 'releaseStore'], 'Master config');
  for (const name of ['host', 'advertiseHost', 'consoleBindHost']) assert.ok(input[name] === undefined || input[name] === '127.0.0.1', 'Master endpoints must be loopback');
  assert.ok(input.role === undefined || input.role === 'master', 'Master role cannot be overridden');
  assert.ok(input.webapp === undefined || input.webapp === false, 'Master fixture has no webapp');
  assert.ok(input.initialized === undefined || input.initialized === true, 'Master must be initialized');
  if (input.initializedAt !== undefined) assert.equal(typeof input.initializedAt, 'string', 'initializedAt must be a string');
  if (input.cluster !== undefined) { record(input.cluster, ['enabled'], 'cluster'); assert.ok(input.cluster.enabled === false, 'Master fixture does not join a cluster'); }
  const execution = path.join(root, 'e');
  if (input.executionHost !== undefined) {
    record(input.executionHost, ['enabled', 'directory'], 'executionHost');
    assert.ok(input.executionHost.enabled === true, 'Canonical execution must be enabled');
    assert.ok(input.executionHost.directory === undefined || input.executionHost.directory === execution, 'Execution directory is owned by fixture');
  }
  if (input.auth !== undefined) {
    record(input.auth, ['jwtSecret'], 'auth');
    assert.ok(typeof input.auth.jwtSecret === 'string' && input.auth.jwtSecret.length > 0, 'auth must contain a JWT secret');
  }
  if (input.releaseStore !== undefined) {
    const store = input.releaseStore;
    record(store, ['endpoint', 'bucket', 'region', 'forcePathStyle', 'prefix', 'accessKey', 'secretKey'], 'releaseStore');
    for (const field of ['endpoint', 'bucket']) assert.ok(typeof store[field] === 'string' && store[field], 'releaseStore is incomplete');
    for (const field of ['region', 'prefix']) assert.ok(store[field] === undefined || typeof store[field] === 'string', 'Invalid releaseStore field type');
    assert.ok(store.forcePathStyle === undefined || typeof store.forcePathStyle === 'boolean', 'Invalid releaseStore path style');
    for (const field of ['accessKey', 'secretKey']) { record(store[field], ['secret'], 'Store credential reference'); assert.ok(typeof store[field].secret === 'string' && store[field].secret, 'Store credentials must be vault references'); }
  }
  for (const name of ['port', 'httpPort']) assert.ok(Number.isInteger(input[name]) && input[name] > 0 && input[name] <= 65535, 'Master ports must be explicit valid integers');
  assert.ok(input.httpPort <= 65532 && ![0, 1, 2, 3].some(offset => input.port === input.httpPort + offset), 'Master port ranges overlap');
  const databaseUrl = env.OMNITRON_DATABASE_URL;
  // Reject literal control bytes before URL parsing can silently discard them.
  assert.ok(typeof databaseUrl === 'string' && !/[\x00-\x1f\x7f]/.test(databaseUrl), 'Explicit private PostgreSQL URL is required');
  let db;
  try { db = new URL(databaseUrl); } catch { throw new Error('Invalid private PostgreSQL URL'); }
  assert.ok(!db.search && !db.hash, 'Private PostgreSQL URL must not contain query or fragment');
  const databasePort = Number(db.port);
  assert.ok(['postgres:', 'postgresql:'].includes(db.protocol) && db.hostname === '127.0.0.1' && Number.isInteger(databasePort) && databasePort > 0 && databasePort <= 65535 && db.pathname.length > 1, 'PostgreSQL must be a separately prepared loopback database');
  // The SDK decodes these fields; a decoding error there selects its default DB.
  // Reject it before creating the fixture so the supplied DB remains authoritative.
  try {
    for (const value of [db.username, db.password, db.pathname]) decodeURIComponent(value);
  } catch { throw new Error('Invalid encoding in private PostgreSQL URL'); }
  assert.ok(![input.port, ...[0, 1, 2, 3].map(offset => input.httpPort + offset)].includes(Number(db.port)), 'Database and master ports overlap');
  let dockerEnvironment;
  if (env.DOCKER_HOST !== undefined) {
    const host = env.DOCKER_HOST;
    assert.ok(typeof host === 'string' && !/[\x00-\x1f\x7f]/.test(host) && /^unix:\/\/\/[^\s?#]+$/.test(host) &&
      path.resolve(host.slice('unix://'.length)) === host.slice('unix://'.length),
    'Explicit fixture Docker host must be a canonical Unix socket endpoint');
    // A native unit does not inherit the invoking Python process's environment.
    // Empty competing Docker selectors keep the reviewed Unix endpoint authoritative.
    dockerEnvironment = { DOCKER_HOST: host, DOCKER_CONTEXT: '', DOCKER_TLS_VERIFY: '', DOCKER_CERT_PATH: '' };
  }
  const daemonConfig = { ...input, role: 'master', initialized: true, webapp: false,
    host: '127.0.0.1', advertiseHost: '127.0.0.1', consoleBindHost: '127.0.0.1',
    cluster: { enabled: false }, executionHost: { enabled: true, directory: execution } };
  return { root, scenario, daemonConfig, databaseUrl, dockerEnvironment,
    requestedPorts: { httpPort: input.httpPort, ports: [input.port] } };
}

export async function removeOwnedFixtureRoot(root, identity) {
  const actual = await fs.lstat(root);
  assert.ok(actual.isDirectory() && !actual.isSymbolicLink() && actual.dev === identity.dev && actual.ino === identity.ino, 'Fixture root identity changed; refusing cleanup');
  await fs.rm(root, { recursive: true, force: false });
}
