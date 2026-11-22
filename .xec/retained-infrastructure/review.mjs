/** Standalone verifier for an operator-provisioned legacy host. Its stdout is the public review. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { inspectRuntimeArtifact } from '../../apps/omnitron/src/shared/runtime-artifact.ts';
import { checkedDeclaration, compareOriginal, localDocker, requiredBindings } from './legacy.mjs';

export function readBoundInput(fd, bytes) {
  const chunks = [];
  let size = 0;
  for (;;) {
    const buffer = Buffer.alloc(16384);
    const length = fs.readSync(fd, buffer, 0, buffer.length, null);
    if (!length) return Buffer.concat(chunks, size);
    size += length;
    if (size > bytes) throw Error('Retained input is too large');
    chunks.push(buffer.subarray(0, length));
  }
}

export async function verifiedInputs({ declaration, expected, runtimeRoot, runtimeManifestSha256, credentialsFd }) {
  if (!Buffer.isBuffer(declaration) || declaration.length > 262144 ||
      createHash('sha256').update(declaration).digest('hex') !== expected)
    throw Error('The release declaration does not match the independent review');
  const subject = checkedDeclaration(JSON.parse(declaration));
  if (!/^[a-f0-9]{64}$/.test(runtimeManifestSha256 ?? '') || !path.isAbsolute(runtimeRoot) ||
      !/^[a-f0-9]{64}$/.test(path.basename(runtimeRoot)) || fs.realpathSync(runtimeRoot) !== runtimeRoot)
    throw Error('Select the installed sealed legacy runtime by its complete digest');
  const manifest = fs.readFileSync(path.join(runtimeRoot, 'RUNTIME.json'));
  if (createHash('sha256').update(manifest).digest('hex') !== runtimeManifestSha256)
    throw Error('The selected runtime manifest differs');
  const verified = await inspectRuntimeArtifact(runtimeRoot, path.basename(runtimeRoot));
  const { containerSpecHash } = await import(pathToFileURL(path.join(runtimeRoot, 'packages/0/dist/infrastructure/container-runtime.js')));
  let bindings = {};
  if (credentialsFd !== undefined) {
    if (!Number.isSafeInteger(credentialsFd) || credentialsFd < 3) throw Error('Private bindings require an inherited descriptor');
    const stat = fs.fstatSync(credentialsFd);
    if (!stat.isFIFO() && !stat.isSocket()) throw Error('The private provider must use a pipe or socket');
    let grant;
    try { grant = JSON.parse(readBoundInput(credentialsFd, 131072)); } catch { throw Error('Invalid private provider envelope'); }
    if (grant.protocol !== 1 || grant.project !== subject.project || grant.stack !== subject.stack ||
        grant.declarationSha256 !== expected || !grant.bindings || typeof grant.bindings !== 'object' ||
        Array.isArray(grant.bindings) || Object.keys(grant.bindings).some(key => !requiredBindings(subject).includes(key)))
      throw Error('The private provider is not bound to this release');
    bindings = grant.bindings;
  }
  await verified.assertUnchanged();
  return { subject, authorities: { docker: localDocker, fingerprint: containerSpecHash, bindings } };
}

export async function runRetainedReview(options) {
  const { subject, authorities } = await verifiedInputs(options);
  return { ...compareOriginal(subject, authorities), declarationSha256: options.expected };
}
