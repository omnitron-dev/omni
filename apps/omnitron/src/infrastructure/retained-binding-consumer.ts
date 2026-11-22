import { spawn } from 'node:child_process';
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import path from 'node:path';
import type { Writable } from 'node:stream';
import { inspectRuntimeArtifact } from '../shared/runtime-artifact.js';
import { assertBinding, bindingReference, bindingRoles, fields, isId, isSha, roleRow, sha256,
  type BindingRole, type BindingSubject, type BindingTicket } from './retained-binding-ticket.js';

// The independently published eight-module source consumer. A ticket cannot nominate new executable code.
export const retainedConsumerManifest = '266fdc08a19f29d03d8d2f60ad2ede0d05175c65e54c83948222b86e1282a89e';
const modules = ['config-payload', 'legacy', 'operation', 'physical', 'review', 'runtime-artifact', 'source', 'stage'].map(n => n + '.mjs');
export function ownerDirectory(dir: string, create = false): string {
  if (create) { try { mkdirSync(dir, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; } }
  const meta = lstatSync(dir);
  assertBinding(realpathSync(dir) === dir && meta.isDirectory() && meta.uid === process.getuid?.() && !(meta.mode & 0o077));
  return dir;
}
export function ownerFile(file: string, max: number, privateFile = false): Buffer {
  assertBinding(realpathSync(file) === file);
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const st = fstatSync(fd);
    assertBinding(st.isFile() && st.nlink === 1 && st.uid === process.getuid?.() && !(st.mode & (privateFile ? 0o077 : 0o022)) &&
      st.size > 0 && st.size <= max);
    return readFileSync(fd);
  } finally { closeSync(fd); }
}
function originalEngine(socket: string) {
  const st = lstatSync(socket);
  assertBinding(process.platform === 'linux' && realpathSync(socket) === socket && st.isSocket() && st.uid === process.getuid?.());
}

/** Inspect only the empty/nonempty result of Docker's full-ID inventory filter. No container object is decoded. */
export function containsFilteredId(socketPath: string, filters: Record<string, string[]>): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, method: 'GET', path: '/containers/json?' + new URLSearchParams({ filters: JSON.stringify(filters) }) },
      res => {
        let prefix = '';
        if (res.statusCode !== 200) { res.destroy(); reject(Error('Original engine did not confirm inventory')); return; }
        res.on('error', reject);
        res.on('data', (chunk: Buffer) => {
          for (const byte of chunk) {
            if ([9, 10, 13, 32].includes(byte)) continue;
            prefix += String.fromCharCode(byte);
            if (prefix.length === 2) {
              if (prefix === '[]' || prefix === '[{') resolve(prefix === '[{');
              else reject(Error('Original engine inventory is invalid'));
              res.destroy();
              return;
            }
          }
        });
        res.on('end', () => { if (prefix.length < 2) reject(Error('Original engine inventory is incomplete')); });
      });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(Error('Original engine inventory timed out')));
    req.end();
  });
}
export async function matchOriginal(ticket: BindingTicket, subject: BindingSubject, role: BindingRole, fingerprint: string) {
  assertBinding(/^[a-f0-9]{16}$/.test(fingerprint));
  originalEngine(ticket.engineSocket);
  const row = roleRow(subject, role);
  const matches = (label: string) => containsFilteredId(ticket.engineSocket, {
    id: [row.originalId], name: ['^/' + row.spec.name + '$'], label: ['omnitron.managed=true', 'omnitron.project=' + ticket.project,
      'omnitron.stack=' + ticket.stack, 'omnitron.service=' + role, label],
  });
  assertBinding(await matches('omnitron.spec-hash') && !(await matches('omnitron.spec-hash-schema')));
  return matches('omnitron.spec-hash=' + fingerprint);
}

export function consumerOptions(t: BindingTicket, raw: string, home: string) {
  assertBinding(t.consumer && typeof raw === 'string' && Buffer.byteLength(raw) <= 16384 && sha256(raw) === t.consumer.optionsSha256);
  const options = JSON.parse(raw);
  const names = ['directory', 'volumeRoot', ...(t.purpose === 'create-stopped' ? ['seal', 'nodeStop'] : []),
    ...(Object.hasOwn(options, 'publicSupplement') ? ['publicSupplement'] : [])];
  assertBinding(fields(options, names) && options.directory === path.join(home, 'retained-bindings', 'returns', t.declarationSha256) &&
    typeof options.volumeRoot === 'string' && path.isAbsolute(options.volumeRoot) && path.normalize(options.volumeRoot) === options.volumeRoot &&
    (!Object.hasOwn(options, 'publicSupplement') || (typeof options.publicSupplement === 'string' && path.isAbsolute(options.publicSupplement))) &&
    (t.purpose !== 'create-stopped' || (isSha(options.seal) && isId(options.nodeStop))));
  return options;
}

/** All names originate in the accepted release, fixed native bundle, and separately authorized operation. */
export async function prepareConsumer(home: string, t: BindingTicket, declaration: string, options: string) {
  assertBinding(t.consumer?.helperSha256 === retainedConsumerManifest && t.purpose !== 'compare');
  originalEngine(t.engineSocket);
  const root = ownerDirectory(path.join(home, 'retained-bindings'));
  const bundles = ownerDirectory(path.join(root, 'bundles'));
  const bundle = ownerDirectory(path.join(bundles, retainedConsumerManifest));
  const manifest = ownerFile(path.join(bundle, 'FILES.json'), 16384);
  assertBinding(sha256(manifest) === retainedConsumerManifest);
  const body = JSON.parse(manifest.toString('utf8'));
  assertBinding(body.protocol === 1 && fields(body.files, modules));
  for (const name of modules) assertBinding(sha256(ownerFile(path.join(bundle, name), 1048576)) === body.files[name]);
  const selection = consumerOptions(t, options, home);
  ownerDirectory(path.join(root, 'returns'), true);
  ownerDirectory(selection.directory, true);
  const engineConfig = ownerDirectory(path.join(root, 'empty-docker-config'), true);
  assertBinding(readdirSync(engineConfig).length === 0);
  const tickets = ownerDirectory(path.join(root, 'tickets'), true);
  const dir = ownerDirectory(path.join(tickets, t.id), true);
  for (const [name, bytes] of [['declaration.json', declaration], ['options.json', options]] as const) {
    const selected = path.join(dir, name);
    try { writeFileSync(selected, bytes, { flag: 'wx', mode: 0o600 }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    assertBinding(ownerFile(selected, 262144, true).equals(Buffer.from(bytes)));
  }
  const runtime = path.join(home, 'runtime', 'releases', t.consumer.runtimeSha256);
  assertBinding(realpathSync(runtime) === runtime && sha256(ownerFile(path.join(runtime, 'RUNTIME.json'), 16384)) === t.consumer.runtimeManifestSha256);
  const verified = await inspectRuntimeArtifact(runtime, t.consumer.runtimeSha256);
  assertBinding(verified.manifest.platform === process.platform && verified.manifest.arch === process.arch);
  await verified.assertUnchanged();
  const args = [path.join(bundle, 'source.mjs'), t.purpose, path.join(dir, 'declaration.json'), t.declarationSha256,
    runtime, t.consumer.runtimeManifestSha256, path.join(dir, 'options.json'), '3'];
  return async (values: Record<BindingRole, string>) => {
    await verified.assertUnchanged();
    for (const name of modules) assertBinding(sha256(ownerFile(path.join(bundle, name), 1048576)) === body.files[name]);
    assertBinding(t.expiresAt > Date.now() && readdirSync(engineConfig).length === 0);
    const bindings = Object.fromEntries(bindingRoles.map(r => [bindingReference(r, t.project, t.stack), values[r]]));
    const input = Buffer.from(JSON.stringify({ protocol: 1, project: t.project, stack: t.stack, declarationSha256: t.declarationSha256, bindings }));
    try {
      const raw = await new Promise<string>((resolve, reject) => {
        const proc = spawn(path.join(runtime, 'node'), args, { cwd: dir,
          env: { PATH: '/usr/bin:/bin', HOME: home, DOCKER_HOST: 'unix://' + t.engineSocket, DOCKER_CONFIG: engineConfig },
          stdio: ['ignore', 'pipe', 'ignore', 'pipe'], timeout: Math.max(1, Math.min(300000, t.expiresAt - Date.now())), killSignal: 'SIGKILL' });
        const chunks: Buffer[] = [];
        let size = 0;
        proc.stdout!.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size <= 65536) chunks.push(chunk); else proc.kill('SIGKILL');
        });
        proc.once('error', reject);
        proc.once('close', code => code === 0 && size <= 65536 ? resolve(Buffer.concat(chunks).toString()) : reject(Error('Closed consumer did not confirm')));
        const fd = proc.stdio[3] as Writable;
        fd.on('error', reject);
        fd.end(input);
      });
      const receipt = JSON.parse(raw);
      assertBinding(receipt?.protocol === 1);
      if (t.purpose === 'seal') {
        assertBinding(receipt.project === t.project && receipt.stack === t.stack && receipt.release === t.release && isSha(receipt.sealSha256));
        return { sealSha256: receipt.sealSha256 };
      }
      const roles = Object.keys(receipt.created ?? {}).sort();
      const original = (JSON.parse(declaration) as BindingSubject).services.map(r => r.spec.labels['omnitron.service']).sort();
      assertBinding(receipt.project === t.project && receipt.stack === t.stack && receipt.running === 0 &&
        JSON.stringify(roles) === JSON.stringify(original) && roles.every(r => isSha(receipt.created[r])));
      return { created: Object.fromEntries(roles.map(r => [r, receipt.created[r] as string])), running: 0 };
    } finally { input.fill(0); }
  };
}
