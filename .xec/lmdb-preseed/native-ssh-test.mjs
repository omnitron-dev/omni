// Run exported management commands through the installed runtime's actual Xec SSH adapter.
// The bridge exposes only the labelled, internal Docker fixture's sshd on an ephemeral loopback port.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const [runtime, container, keyFile, definitionFile, specFile] = process.argv.slice(2);
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' });
const [fixture] = JSON.parse(docker('inspect', container));
assert(fixture.Config.Labels['org.omnitron.preseed-qa'] && fixture.State.Running && fixture.Mounts.length === 0);
const networks = Object.keys(fixture.NetworkSettings.Networks);
assert(networks.length === 1 && JSON.parse(docker('network', 'inspect', networks[0]))[0].Internal);
const relay = `import os,socket,threading
s=socket.create_connection(('127.0.0.1',22))
def upload():
    try:
        while True:
            b=os.read(0,65536)
            if not b: break
            s.sendall(b)
        s.shutdown(socket.SHUT_WR)
    except OSError: pass
threading.Thread(target=upload,daemon=True).start()
while True:
    b=s.recv(65536)
    if not b: break
    with memoryview(b) as buf:
        while buf: buf=buf[os.write(1,buf):]`;
const bridges = new Set();
const server = net.createServer(socket => {
  const child = spawn('docker', ['exec', '-i', container, 'python3', '-u', '-c', relay], { stdio: ['pipe', 'pipe', 'ignore'] });
  bridges.add(child);
  child.stdin.on('error', () => {});
  child.stdout.pipe(socket);
  socket.pipe(child.stdin);
  socket.on('error', () => child.kill());
  child.on('exit', () => { socket.destroy(); bridges.delete(child); });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { ExecutionService, sshConfig } = await import(pathToFileURL(path.join(runtime, 'packages/0/dist/execution/execution.service.js')));
const service = new ExecutionService({ debug() {}, info() {}, warn() {} });
try {
  const spec = JSON.parse(await fs.readFile(specFile)), graph = JSON.parse(await fs.readFile(definitionFile));
  const target = { type: 'ssh', ...sshConfig({ host: '127.0.0.1', port: server.address().port, username: 'root',
    expectedHostFingerprint: spec.sourceFingerprint, privateKey: await fs.readFile(keyFile, 'utf8') }) };
  const results = [];
  for (const step of graph.steps.filter(step => step.nodeId === spec.sourceNode)) {
    const result = await service.execute({ command: step.run, shell: true, adapter: 'ssh', adapterOptions: target, timeout: 120000 });
    assert.equal(result.exitCode, 0);
    const receipt = JSON.parse(result.stdout);
    if (step.name === 'offer') assert(receipt.anchor.height >= spec.minimumHeight);
    else assert.equal(receipt.helperSha256, spec.helperSha256);
    results.push({ step: step.name, bytes: Buffer.byteLength(step.run), exitCode: result.exitCode,
      ...(step.name === 'offer' ? { height: receipt.anchor.height } : { alreadyInstalled: receipt.alreadyInstalled }) });
  }
  console.log(JSON.stringify({ fixtureHostPinVerified: true, nativeRuntime: path.basename(runtime), commands: results }, null, 2));
} catch (error) {
  process.stderr.write('The isolated native SSH qualification failed (' + error.constructor.name + ').\n');
  process.exitCode = 1;
} finally {
  await service.dispose();
  for (const child of bridges) child.kill();
  server.close();
}
