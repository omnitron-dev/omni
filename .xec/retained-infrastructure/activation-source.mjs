/** Runs on the original Linux owner. Stdout contains the single public activation result. */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameSet = (a, b) => same(a.toSorted(), b.toSorted());
const requireState = (condition, message) => {
  if (!condition) throw Error(message);
};
const exactId = (id) => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id);
const clock = () => Date.now() / 1000;

function regular(file, limit, uid, privateMode = false) {
  requireState(path.isAbsolute(file) && fs.realpathSync(file) === file, 'Selected source file traverses a link');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const st = fs.fstatSync(fd);
    requireState(
      st.isFile() &&
        st.nlink === 1 &&
        st.uid === uid &&
        !(st.mode & (privateMode ? 0o077 : 0o022)) &&
        st.size > 0 &&
        st.size <= limit,
      'Unexpected source file identity'
    );
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function directory(file, uid, privateMode = false) {
  const st = fs.lstatSync(file);
  requireState(
    fs.realpathSync(file) === file && st.isDirectory() && st.uid === uid && !(st.mode & (privateMode ? 0o077 : 0o022)),
    'Unexpected source directory'
  );
}

function persist(file, value) {
  const temporary = file + '.' + randomUUID();
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, file);
  const parent = fs.openSync(path.dirname(file), fs.constants.O_DIRECTORY);
  try {
    fs.fsyncSync(parent);
  } finally {
    fs.closeSync(parent);
  }
}

function localDocker(socket, config, args) {
  const list = args[0] === 'ps' || (['image', 'network', 'volume'].includes(args[0]) && args[1] === 'ls');
  requireState(list, 'Unsupported local Docker read');
  const answer = spawnSync('/usr/bin/docker', ['--config', config, '--host', 'unix://' + socket, ...args], {
    encoding: 'utf8',
    timeout: 20000,
    maxBuffer: 65536,
    env: { PATH: '/usr/bin:/bin', LANG: 'C' },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  requireState(answer.status === 0 && !answer.error, 'The local Docker engine did not confirm its filtered inventory');
  return answer.stdout.trim();
}

function request(socket, method, endpoint) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: socket,
        method,
        path: endpoint,
        agent: false,
        headers: { Connection: 'close', Accept: 'application/json' },
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (bytes) => {
          size += bytes.length;
          if (size > 262144) req.destroy(Error('Oversized local engine reply'));
          else chunks.push(bytes);
        });
        res.on('error', reject);
        res.on('end', () => {
          try {
            const bytes = Buffer.concat(chunks);
            resolve([res.statusCode, bytes.length ? JSON.parse(bytes.toString()) : null]);
          } catch {
            reject(Error('Invalid local engine reply'));
          }
        });
      }
    );
    req.setTimeout(30000, () => req.destroy(Error('Local engine reply timed out')));
    req.on('error', reject);
    req.end();
  });
}

export function enginePort(socket, fetch = request) {
  return {
    async verify(id, name, running) {
      requireState(exactId(id), 'Invalid passive identity');
      const root = '/containers/' + id;
      const [status, stats] = await fetch(socket, 'GET', root + '/stats?stream=false&one-shot=true');
      requireState(
        status === 200 && stats.id === id && stats.name?.replace(/^\//, '') === name,
        'The native engine resolved a different container'
      );
      const [top, processes] = await fetch(socket, 'GET', root + '/top?ps_args=-eo%20pid');
      requireState(
        running
          ? top === 200 &&
              same(processes.Titles, ['PID']) &&
              processes.Processes?.length > 0 &&
              processes.Processes.every((row) => Array.isArray(row) && row.length === 1 && /^\d+$/.test(row[0]))
          : top === 409,
        'Unexpected native process state'
      );
    },
    async start(id) {
      requireState(exactId(id), 'Invalid passive identity');
      const [status] = await fetch(socket, 'POST', '/containers/' + id + '/start');
      requireState(status === 204 || status === 304, 'The native engine did not confirm the start request');
    },
  };
}

export async function startOne(s, { inventory, engine, guard, journal, write, now = clock }) {
  const { order, role, created } = s;
  const identity = {
    protocol: 1,
    project: s.project,
    stack: s.stack,
    source: s.sourceNode,
    receiver: s.receiverNode,
    nodeStop: s.nodeStop,
    seal: s.owner.seal,
    passiveReview: s.passiveReview,
    declaration: s.declarationSha256,
    allocation: order.map((name) => [name, created[name]]),
  };
  const state = journal ?? { identity, roles: {} };
  requireState(
    same(identity, state.identity) && state.roles && Object.keys(state.roles).every((name) => order.includes(name)),
    'Another passive return owns this journal'
  );
  state.roles = Object.assign(Object.create(null), state.roles);
  const current = () => {
    const byStatus = inventory();
    requireState(
      sameSet(byStatus.all, Object.values(created)) &&
        sameSet(byStatus.ours, byStatus.all) &&
        sameSet([...byStatus.created, ...byStatus.running], byStatus.all),
      'The original source has a changed, exited, paused or extra allocation'
    );
    for (const name of order) {
      const active = byStatus.running.includes(created[name]),
        intent = state.roles[name];
      requireState(
        same(byStatus.roles[name], [created[name]]) &&
          (!intent || ['issued', 'running'].includes(intent)) &&
          (!active || Boolean(intent)) &&
          (intent !== 'running' || active),
        'An object or its source activation history changed'
      );
    }
    return byStatus;
  };
  const live = () => requireState(now() < s.expires && s.expires <= now() + 901, 'The source return admission expired');
  live();
  await guard();
  let inventoryNow = current();
  const index = order.indexOf(role),
    id = created[role],
    name = [s.project, s.stack, role].join('-');
  requireState(
    index >= 0 &&
      order
        .slice(0, index)
        .every((prior) => state.roles[prior] === 'running' && inventoryNow.running.includes(created[prior])),
    'An earlier source role lacks a confirmed activation'
  );
  const active = inventoryNow.running.includes(id);
  await engine.verify(id, name, active);
  if (!active) {
    // A lost start acknowledgment is reconciled only by observing the same live PID set. Never send a second start.
    requireState(!state.roles[role], 'The issued start is unconfirmed; reconcile its original native operation');
    await guard();
    inventoryNow = current();
    live();
    requireState(inventoryNow.created.includes(id), 'The selected object left its initial created state');
    state.roles[role] = 'issued';
    write(state);
    if (now() >= s.expires) {
      delete state.roles[role];
      write(state);
      live();
    }
    try {
      await engine.start(id);
    } catch {
      /* A successful dispatch can outlive its response. */
    }
  }
  await guard();
  inventoryNow = current();
  requireState(inventoryNow.running.includes(id), 'The issued start is unconfirmed; retain its original journal');
  await engine.verify(id, name, true);
  state.roles[role] = 'running';
  write(state);
  return {
    protocol: 1,
    project: s.project,
    stack: s.stack,
    role,
    containerId: id,
    nodeStop: s.nodeStop,
    passiveReview: s.passiveReview,
    running: true,
  };
}

async function main(s) {
  const o = s.owner,
    uid = process.getuid();
  requireState(
    process.platform === 'linux' && process.geteuid() === o.uid && uid === o.uid,
    'Expected original Linux owner'
  );
  directory(o.home, uid);
  directory(o.directory, uid, true);
  directory(o.helper, uid);
  const sock = fs.lstatSync(o.socket);
  requireState(
    fs.realpathSync(o.socket) === o.socket && sock.isSocket() && sock.uid === uid,
    'Expected the original local engine socket'
  );
  const manifest = regular(path.join(o.helper, 'FILES.json'), 16384, uid);
  requireState(hash(manifest) === o.helperManifest, 'The independently admitted public source helper changed');
  const files = JSON.parse(manifest).files;
  const expected = [
    'config-payload.mjs',
    'legacy.mjs',
    'operation.mjs',
    'physical.mjs',
    'review.mjs',
    'runtime-artifact.mjs',
    'source.mjs',
    'stage.mjs',
  ];
  requireState(sameSet(Object.keys(files), expected), 'Unexpected retained helper layout');
  for (const name of expected)
    requireState(
      hash(regular(path.join(o.helper, name), 1048576, uid)) === files[name],
      'A verified public helper module changed'
    );
  const legacy = await import(pathToFileURL(path.join(o.helper, 'legacy.mjs')));
  const { verifyPhysical } = await import(pathToFileURL(path.join(o.helper, 'physical.mjs')));
  const { readStoppedAllocation } = await import(pathToFileURL(path.join(o.helper, 'stage.mjs')));
  const bytes = regular(o.declarationFile, 262144, uid);
  requireState(hash(bytes) === o.declarationFileSha256, 'The public source declaration changed');
  const declaration = legacy.checkedDeclaration(JSON.parse(bytes));
  requireState(
    declaration.project === s.project &&
      declaration.stack === s.stack &&
      hash(JSON.stringify(declaration)) === s.declarationSha256 &&
      sameSet(
        declaration.services.map((r) => r.spec.labels['omnitron.service']),
        s.order
      ),
    'The source declaration has a different scope or role set'
  );
  const sealBytes = regular(path.join(o.directory, o.seal + '.json'), 4 * 1024 * 1024, uid, true);
  requireState(hash(sealBytes) === o.seal, 'The original private source seal changed');
  const seal = JSON.parse(sealBytes);
  requireState(
    seal.protocol === 1 && seal.declaration === s.declarationSha256 && /^[0-9a-f-]{36}$/.test(seal.nonce),
    'The original seal does not bind this declaration'
  );
  const root = path.join(o.home, 'infrastructure-return');
  directory(root, uid, true);
  const key = [s.project, s.stack, s.nodeStop].join('.');
  const selection = JSON.parse(regular(path.join(root, key + '.json'), 4096, uid, true));
  requireState(
    selection.protocol === 1 &&
      selection.project === s.project &&
      selection.stack === s.stack &&
      selection.operation === s.nodeStop &&
      selection.seal === o.seal,
    'The native operation has a different source seal'
  );
  const client = path.join(root, 'empty-docker-client');
  try {
    fs.mkdirSync(client, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  directory(client, uid, true);
  requireState(!fs.readdirSync(client).length, 'Expected an empty local Docker client configuration');
  const docker = (args) => localDocker(o.socket, client, args),
    scope = { project: s.project, stack: s.stack };
  const guard = async () => {
    await readStoppedAllocation(path.join(o.home, 'data', 'daemon-state.db'), declaration, s.nodeStop);
    verifyPhysical(seal.physical, declaration, docker, seal.volumeRoot);
  };
  const by = (role, label, status) =>
    legacy.dockerInventory(
      (args) => docker(status ? [...args, '--filter', 'status=' + status] : args),
      scope,
      role,
      label,
      true
    );
  const nonce = 'omnitron.creation=' + seal.nonce;
  const inventory = () => ({
    all: by(),
    ours: by(undefined, nonce),
    created: by(undefined, nonce, 'created'),
    running: by(undefined, nonce, 'running'),
    roles: Object.fromEntries(s.order.map((name) => [name, by(name, nonce)])),
  });
  // An OS-backed SQLite write transaction serializes source activations. Intent is fsynced in a separate journal before dispatch.
  const lockPath = path.join(root, key + '.start-lock.db');
  try {
    fs.closeSync(fs.openSync(lockPath, 'wx', 0o600));
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const st = fs.lstatSync(lockPath);
  requireState(st.isFile() && st.nlink === 1 && st.uid === uid && !(st.mode & 0o077), 'Invalid source activation lock');
  const lock = new DatabaseSync(lockPath);
  try {
    lock.exec('PRAGMA busy_timeout=3000; BEGIN IMMEDIATE');
    const location = path.join(root, key + '.activation.json');
    const journal = fs.existsSync(location) ? JSON.parse(regular(location, 32768, uid, true)) : undefined;
    return await startOne(s, {
      inventory,
      engine: enginePort(o.socket),
      guard,
      journal,
      write: (value) => persist(location, value),
    });
  } finally {
    lock.close();
  }
}

if (process.argv[1] === '-') {
  try {
    const s = JSON.parse(Buffer.from(process.argv[2], 'base64url'));
    console.log(JSON.stringify(await main(s)));
  } catch {
    process.stderr.write(
      'Source activation is unconfirmed. Retain the same object IDs and inspect the original operation.\n'
    );
    process.exitCode = 1;
  }
}
