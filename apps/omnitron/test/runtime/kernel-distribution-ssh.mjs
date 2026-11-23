// The disposable Linux fixture supplies a loopback sshd, a synthetic root login
// and an enrolled service account. The only supplied host observation is the
// guardian's inventory; archive transport, privilege drop and registry are real.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function exerciseKernelSSH({ sdk, home, previous, entry, installation, before }) {
  const { ExecutionService } = await sdk('execution/execution.service');
  const { RemoteDeployer } = await sdk('services/remote-deployer.service');
  const { dataChannelRequest, fromDataChannel, throughDataChannel } = await sdk('execution/data-channel');
  const { DEFAULT_LEASE_TIMING, guardScript } = await sdk('services/node-deploy-lease');
  const { managedApplicationCommand, managedHostCommand } = await sdk('services/managed-rollout');
  const { stageCatalogRuntime } = await sdk('services/kernel-distribution');
  const logger = { debug() {}, info() {}, warn() {}, error() {}, trace() {}, fatal() {} };
  const execution = new ExecutionService(logger);
  const driver = new RemoteDeployer(logger, execution);
  const expectedHostFingerprint = (await fs.readFile('/run/omnitron-kernel-qa/pin', 'utf8')).trim();
  const password = (await fs.readFile(path.join(home, 'fixture-password'), 'utf8')).trim();
  const login = { host: '127.0.0.1', username: 'root', password, expectedHostFingerprint };
  const target = { ...login, sshPort: 2222 };
  const account = { uid: process.getuid(), gid: process.getgid(), instanceHome: home };
  const bundle = { root: path.join(previous.runtimeRoot, 'packages/0'), managed: { ...entry,
    backendArtifact: previous.runtimeHash, ownerId: 'fixture-owner', applicationAccount: account } };
  const ssh = execution.ssh.bind(execution);
  const upload = execution.uploadFile.bind(execution);
  let uploads = 0, framed = 0, maxCommandBytes = 0, loseInstall = true, loseUpload = true;
  execution.ssh = async (host, command, options) => {
    maxCommandBytes = Math.max(maxCommandBytes, Buffer.byteLength(command));
    assert.ok(maxCommandBytes <= 24 * 1024, 'SSH exec request exceeded its transport budget');
    if (options?.stdin) framed++;
    const result = await ssh(host, command, options);
    const data = fromDataChannel(result.stdout);
    if (loseInstall && result.exitCode === 0 && data.ok && data.text === JSON.stringify({ installed: true, artifact: entry.artifact })) {
      loseInstall = false;
      throw Error('Fixture lost installation confirmation');
    }
    return result;
  };
  execution.uploadFile = async (...args) => {
    uploads++;
    await upload(...args);
    if (loseUpload) {
      loseUpload = false;
      throw Error('Fixture lost archive promotion confirmation');
    }
  };
  const stage = () => driver.underLease(target, 'stage managed kernel', () => stageCatalogRuntime({
    inspectInstalledBundle: async () => bundle,
    readFromNode: driver.readFromNode.bind(driver),
    uploadToNode: driver.uploadToNode.bind(driver),
  }, target, entry.commit));
  const archive = DEFAULT_LEASE_TIMING.dir + '/kernel-' + entry.archive + '.tgz';
  try {
    const inspect = managedHostCommand({ operation: 'inspect' });
    const guarded = guardScript(DEFAULT_LEASE_TIMING, 'fixture-token', inspect);
    const oldCommandBytes = Buffer.byteLength(throughDataChannel(guarded));
    assert.ok(oldCommandBytes > 35000);
    // Exercise the retired wire format against the disposable sshd. The
    // synthetic lease token cannot authorize a command even if it arrives.
    let oldOutcome;
    try {
      const old = await ssh({ ...login, port: 2222 }, throughDataChannel(guarded), { timeout: 12_000 });
      oldOutcome = old.exitCode === 73 ? 'reached-lease-check' : 'unexpected-exit';
    } catch (error) {
      if (!/outcome is unknown|packet.*too large/i.test(String(error))) throw error;
      oldOutcome = 'transport-refused';
    }
    assert.ok(['reached-lease-check', 'transport-refused'].includes(oldOutcome));
    const proof = await driver.underLease(target, 'inspect managed kernel', () => driver.readFromNode(target, inspect));
    assert.notEqual(proof.code, 0);
    assert.match(proof.stderr, /no installed managed supervisor/);
    const plain = await driver.underLease(target, 'exercise ordinary managed command', () =>
      driver.runOnNode(target, '# ' + 'x'.repeat(48 * 1024) + '\nprintf plain-input-ok'));
    assert.equal(plain.code, 0);
    assert.equal(plain.stdout.trim(), 'plain-input-ok');
    const frame = dataChannelRequest(guarded);
    const incomplete = await ssh({ ...login, port: 2222 }, frame.command, { stdin: frame.stdin.subarray(0, -1) });
    assert.notEqual(incomplete.exitCode, 0);
    assert.match(incomplete.stderr, /Incomplete SSH command frame/);
    const changed = await driver.readFromNode(target, managedApplicationCommand({ ...account, uid: account.uid + 1 }, 'echo unreachable'));
    assert.notEqual(changed.code, 0);
    assert.match(changed.stderr, /enrolled application account changed/);
    const unbound = await driver.readFromNode(target, managedApplicationCommand({ instanceHome: home }, 'echo unreachable'));
    assert.notEqual(unbound.code, 0);
    assert.match(unbound.stderr, /enrolled application account changed/);
    await assert.rejects(stage, /lost archive promotion confirmation/);
    const retained = await driver.readFromNode(target, 'stat -c "%u:%h:%a:%s" ' + archive);
    assert.equal(retained.stdout, '0:1:600:' + entry.bytes);
    await assert.rejects(fs.stat(archive), { code: 'EACCES' });
    await assert.rejects(stage, /lost installation confirmation/);
    assert.equal((await installation.artifact(entry.artifact)).build.commit, entry.commit);
    assert.equal(await stage(), entry.artifact);
    assert.equal(uploads, 1);
    assert.ok(framed > 0);
    assert.equal((await driver.readFromNode(target, 'test ! -e ' + archive)).code, 0);
    assert.equal((await fs.stat(path.join(installation.releasePath(entry.artifact), 'node'))).uid, account.uid);
    assert.equal((await fs.stat(path.join(installation.directory, 'state.db'))).uid, account.uid);
    assert.deepEqual(installation.selection(), before);
    assert.equal(installation.activation(), null);
    console.log(JSON.stringify({ adminUid: 0, serviceUid: account.uid, serviceGid: account.gid, oldCommandBytes, oldOutcome,
      maxCommandBytes, framed, uploads, lostAcknowledgments: 2, selected: false }));
  } finally { await execution.dispose(); }
}
