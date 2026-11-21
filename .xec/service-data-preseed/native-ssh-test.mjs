// Use a loopback-only SSH port for a disposable Linux fixture whose sole accepted key is bound to this graph.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [runtime, fixturePort, key, graphFile, specFile] = process.argv.slice(2);
const port = Number(fixturePort);
assert(Number.isInteger(port) && port > 1024 && port <= 65535);
const graph = JSON.parse(await fs.readFile(graphFile)),
  spec = JSON.parse(await fs.readFile(specFile));
assert.equal(spec.project, 'fixture');
const normalExport = JSON.parse(
  execFileSync(path.resolve('node_modules/.bin/xec'), ['service-data-preseed', 'bootstrap-receiver', specFile], {
    maxBuffer: 2 * 1024 * 1024,
  })
);
assert.equal(
  JSON.stringify(graph),
  JSON.stringify(normalExport),
  'The fixture must execute the reviewed exporter bytes'
);
const cli = path.join(runtime, 'packages/0/dist/cli/omnitron.js');
const check = JSON.parse(execFileSync(path.join(runtime, 'node'), [cli, '--json', 'pipeline', 'check', graphFile]));
assert(check.ok);
const { ExecutionService, sshConfig } = await import(
  pathToFileURL(path.join(runtime, 'packages/0/dist/execution/execution.service.js'))
);
const service = new ExecutionService({ debug() {}, info() {}, warn() {} });
try {
  const target = {
    type: 'ssh',
    ...sshConfig({
      host: '127.0.0.1',
      port,
      username: 'root',
      expectedHostFingerprint: spec.receiverFingerprint,
      privateKey: await fs.readFile(key, 'utf8'),
    }),
  };
  const commands = [];
  for (const step of graph.steps.slice(1)) {
    assert.equal(step.nodeId, spec.receiverNode);
    assert(Buffer.byteLength(step.run) <= 22 * 1024);
    const result = await service.execute({
      command: step.run,
      shell: true,
      adapter: 'ssh',
      adapterOptions: target,
      timeout: 120000,
    });
    assert.equal(result.exitCode, 0);
    const receipt = JSON.parse(result.stdout);
    if (step.name === 'bootstrap-receiver') assert.equal(receipt.side, 'receiver');
    else assert.match(receipt.helperSha256, /^[0-9a-f]{64}$/);
    commands.push({ step: step.name, bytes: Buffer.byteLength(step.run), exitCode: result.exitCode });
  }
  console.log(
    JSON.stringify(
      { runtime: path.basename(runtime), sourceSha256: check.data.sourceSha256, realOpenSSH: true, commands },
      null,
      2
    )
  );
} finally {
  await service.dispose();
}
