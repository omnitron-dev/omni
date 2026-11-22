import { createHash, generateKeyPairSync } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const [dist, action, ticket] = process.argv.slice(2);
if (action === 'fixture-ssh-keys') {
  if (process.env.OMNITRON_DISPOSABLE_HOST_CONFIG_TEST !== '1' || process.getuid?.() !== 0) process.exit(2);
  const string = bytes => { const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length); return Buffer.concat([length, bytes]); };
  for (const name of ['allowed', 'restricted', 'tcp-only']) {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const pub = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
    const wire = Buffer.concat([string(Buffer.from('ssh-ed25519')), string(pub)]);
    const path = '/tmp/host-config-qa-ssh/' + name;
    await writeFile(path, privateKey.export({ format: 'pem', type: 'pkcs8' }), { flag: 'wx', mode: 0o600 });
    await writeFile(path + '.pub', 'ssh-ed25519 ' + wire.toString('base64') + '\n', { flag: 'wx', mode: 0o600 });
  }
  process.exit(0);
}
const load = name => import(pathToFileURL(join(dist, 'infrastructure', name + '.js')));
const { hostBindingMaterial, HOST_BINDING_PROFILES } = await load('host-binding-review');
const [, pub] = (await readFile('/etc/ssh/ssh_host_ed25519_key.pub', 'utf8')).trim().split(/\s+/);
const pin = 'SHA256:' + createHash('sha256').update(Buffer.from(pub, 'base64')).digest('base64').replace(/=+$/, '');
const subject = { project: 'fixture', stack: 'local', release: 'fixture-release', nodeId: 'fixture-recipient',
  commit: '1'.repeat(40), manifestSha256: '2'.repeat(64), sshFingerprint: pin };
const declared = {}, overrides = {}, store = new Map();
for (const [name, profile] of Object.entries(HOST_BINDING_PROFILES)) {
  const slots = profile.directives.flatMap(line => [...line.matchAll(/\$\{secret:(\w+)\}/g)].map(m => m[1]));
  declared[name] = { ports: {}, env: {}, bareMetal: { systemdUnit: profile.unit, configFile: profile.config,
    configTemplate: profile.directives.join('\n') + '\n', user: profile.user, dataDir: profile.chainDataDir ?? undefined,
    unitTemplate: '[Service]\nUser=${user}\nExecStart=/bin/true\n' } };
  overrides[name] = { provisioning: 'bareMetal', networkMode: 'mainnet', secrets: Object.fromEntries(slots.map(slot => {
    const key = name + '.' + slot;
    store.set(key, slot === 'rpc_auth' ? 'fixture:' + 'a'.repeat(32) + '$' + 'b'.repeat(64) : 'fixture-only-value');
    return [slot, { secret: key }];
  })) };
}
const material = hostBindingMaterial(subject, declared, overrides), review = material.review.digest;
if (action === 'review') console.log(JSON.stringify({ review, nodeId: subject.nodeId }));
else {
  const { installOverHostConfigChannel, connectHostConfigInstaller } = await load('host-config-delivery');
  const grant = { ticket, nodeId: subject.nodeId, review };
  let vaultReads = 0, checks = 0, transport;
  try {
    const keyName = ['restricted', 'tcp-only'].includes(action) ? action : 'allowed';
    const privateKey = await readFile('/tmp/host-config-qa-ssh/' + keyName, 'utf8');
    transport = await connectHostConfigInstaller({ host: '127.0.0.1', port: action === 'tcp-disabled' ? 27434 : 27433, username: 'root', privateKey,
      expectedHostFingerprint: action === 'wrong-pin' ? 'SHA256:' + 'A'.repeat(43) : pin }, ticket, AbortSignal.timeout(80000));
    const receipt = await installOverHostConfigChannel(grant, material, transport.stream,
      async () => { checks++; }, async key => { vaultReads++; return store.get(key) ?? null; });
    console.log(JSON.stringify({ ok: true, receipt, vaultReads, checks }));
  } catch (error) {
    const reason = error?.message === 'The registered administrative SSH route could not authenticate the connection' ? 'SSH authentication'
      : error?.message === 'The registered administrative SSH route cannot reach the authorized host configuration listener' ? 'Unix forwarding'
        : 'protocol';
    console.log(JSON.stringify({ ok: false, reason, vaultReads, checks })); process.exitCode = 1;
  }
  finally { transport?.close(); }
}
