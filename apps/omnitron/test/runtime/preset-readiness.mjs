/** Real preset readiness on disposable, memory-backed PostgreSQL, Redis and MinIO.
 * node test/runtime/preset-readiness.mjs dist [receipt.json]
 * Requires the preset images already installed; never pulls or touches managed containers.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const run = promisify(execFile);
const docker = process.env.DOCKER_BINARY || 'docker';
const dist = path.resolve(process.argv[2] || 'dist');
const load = name => import(pathToFileURL(path.join(dist, 'infrastructure/presets', name + '.js')));
const { postgresPreset } = await load('postgres');
const { minioPreset } = await load('minio');
const { createDefaultRegistry } = await load('index');
const nonce = randomBytes(12).toString('hex');
const owned = [];
const report = { test: 'preset-readiness', nonce, liveActivation: false, passed: false, checks: [] };
const exec = async args => (await run(docker, args, { timeout: 30_000, maxBuffer: 1024 * 1024 })).stdout.trim();
const provider = await exec(['info', '--format', '{{.ID}}']);
const logger = { info() {}, debug() {}, warn() {}, error() {} };
const inspect = async resource => {
  assert.equal(await exec(['info', '--format', '{{.ID}}']), provider);
  const [value] = JSON.parse(await exec(['inspect', resource.id]));
  assert.equal(value.Id, resource.id);
  assert.equal(value.Image, resource.image);
  assert.equal(value.Config.Labels['omnitron.test'], nonce);
  assert.equal(value.HostConfig.NetworkMode, 'none');
  assert(!value.Mounts.some(m => m.Type === 'volume'));
  return value;
};
const create = async (kind, image, args, command = kind === 'minio' ? ['server', '/data'] : []) => {
  const id = await exec(['create', '--pull=never', '--name', `omnitron-setup-qa-${nonce}-${kind}`,
    '--label', `omnitron.test=${nonce}`, '--network=none', '--cpus=1', '--memory=512m', '--memory-swap=512m',
    '--pids-limit=128', ...args, image, ...command]);
  const resource = { id, image }; owned.push(resource);
  await inspect(resource); await exec(['start', id]);
  return command => exec(['exec', id, ...command]);
};
const wait = async operation => {
  const deadline = Date.now() + 90_000;
  while (true) {
    try { await operation(); return; }
    catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
};
try {
  const pgImage = await exec(['image', 'inspect', postgresPreset.defaultImage, '--format', '{{.Id}}']);
  const minioImage = await exec(['image', 'inspect', minioPreset.defaultImage, '--format', '{{.Id}}']);
  const pg = await create('postgres', pgImage, ['--tmpfs', '/var/lib/postgresql/data:rw,size=256m',
    '--shm-size=64m', '--env', 'POSTGRES_USER=postgres', '--env', 'POSTGRES_HOST_AUTH_METHOD=trust']);
  await wait(() => pg(['pg_isready', '-U', 'postgres']));
  await pg(['sh', '-ec', postgresPreset.defaultHealthCheck.target]);
  const password = nonce + " 'fixture $()";
  const preset = createDefaultRegistry().expand('redis', { preset: 'redis', secrets: { password } });
  const redisImage = await exec(['image', 'inspect', preset.docker.image, '--format', '{{.Id}}']);
  const redis = await create('redis', redisImage, ['--tmpfs', '/data:rw,size=33554432',
    '--env', 'REDISCLI_AUTH=' + password], preset.docker.command);
  await wait(() => redis(['sh', '-ec', preset.healthCheck.target]));
  assert.equal(await redis(['redis-cli', 'ping']), 'PONG');
  assert.match(await redis(['env', '-u', 'REDISCLI_AUTH', 'redis-cli', 'ping']), /NOAUTH/);
  report.checks.push('Redis requires the declared credential and its health probe authenticates');
  const database = 'setup\'"-fixture';
  const pgContext = { containerName: 'fixture', secrets: { user: 'postgres' }, logger,
    execInContainer: pg, userConfig: { databases: { [database]: { extensions: ['pgcrypto'] } } } };
  await postgresPreset.postProvision(pgContext);
  await postgresPreset.postProvision(pgContext);
  assert.equal(await pg(['psql', '-X', '-U', 'postgres', '-d', database, '-tAc', "SELECT count(*) FROM pg_extension WHERE extname='pgcrypto'"]), '1');
  report.checks.push('Quoted database names, required extension, idempotent retry');
  pgContext.userConfig.databases[database].extensions.push('omnitron_missing_fixture_extension');
  await assert.rejects(postgresPreset.postProvision(pgContext), /requires extension/);
  report.checks.push('Missing required extension refuses readiness on healthy PostgreSQL');

  const secret = randomBytes(24).toString('hex');
  const mc = await create('minio', minioImage, ['--tmpfs', '/data:rw,size=128m',
    '--env', 'MINIO_ROOT_USER=fixture-admin', '--env', `MINIO_ROOT_PASSWORD=${secret}`]);
  await wait(async () => {
    await mc(['mc', 'alias', 'set', 'local', 'http://localhost:9000', 'fixture-admin', secret]);
    await mc(['mc', 'ready', 'local']);
  });
  await mc(['mc', 'mb', 'local/assets']);
  await mc(['mc', 'anonymous', 'set', 'public', 'local/assets']);
  const minioContext = { containerName: 'fixture', logger, execInContainer: mc,
    secrets: { accessKey: 'fixture-admin', secretKey: secret }, userConfig: { buckets: ['assets', 'profiles'] } };
  await minioPreset.postProvision(minioContext);
  await minioPreset.postProvision(minioContext);
  for (const bucket of minioContext.userConfig.buckets) {
    const result = JSON.parse(await mc(['mc', 'anonymous', 'get', '--json', `local/${bucket}`]));
    assert.equal(result.status, 'success'); assert.equal(result.permission, 'private');
  }
  report.checks.push('Existing public and new buckets both become private, idempotently');
  await assert.rejects(minioPreset.postProvision({ ...minioContext, secrets: { accessKey: 'fixture-admin', secretKey: 'invalid-fixture-credential' } }));
  report.checks.push('Rejected storage credentials refuse readiness');
  report.passed = true;
} finally {
  const failures = [];
  for (const resource of owned.reverse()) {
    try {
      const current = await inspect(resource);
      if (current.State.Running) await exec(['stop', '--time', '15', resource.id]);
      await exec(['rm', resource.id]);
    } catch (error) { failures.push(error); }
  }
  report.cleanup = { passed: failures.length === 0, resources: owned.map(x => x.id), volumes: false };
  if (process.argv[3]) await fs.writeFile(path.resolve(process.argv[3]), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(report));
  if (failures.length) throw new AggregateError(failures, 'Private preset fixture cleanup failed');
}
