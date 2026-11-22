import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { buildRetainedBundle } from '../commands/retained-infrastructure.js';
import { reserveSourceSeal } from './operation.mjs';
import { runtimeArtifactDigest } from '../../apps/omnitron/src/shared/runtime-artifact.ts';

const sha = v => createHash('sha256').update(v).digest('hex');

test('the independent helper verifies an immutable runtime and receives scoped data only through an inherited pipe', async t => {
  const area = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'omni-infra-public-')));
  t.after(() => fs.rm(area, { recursive: true, force: true }));
  const helper = path.join(area, 'helper'), stage = path.join(area, 'runtime'), bin = path.join(area, 'bin');
  await buildRetainedBundle(helper);
  const dist = path.join(stage, 'packages/0/dist/infrastructure');
  await fs.mkdir(dist, { recursive: true });await fs.mkdir(bin);
  await fs.writeFile(path.join(dist, 'container-runtime.js'), "import {createHash} from 'node:crypto'; export const containerSpecHash = d => createHash('sha256').update(d.environment.KEY).digest('hex').slice(0,16);");
  await fs.writeFile(path.join(stage,'packages/0/package.json'), '{"type":"module"}');
  await fs.writeFile(path.join(stage,'node'), 'fixture-runner');
  const hash = await runtimeArtifactDigest(stage), runtime = path.join(area,hash);
  const manifest = JSON.stringify({ protocol: 1, sha256: hash, platform: process.platform, arch: process.arch, nodeVersion:process.version, packages:1 });
  await fs.writeFile(path.join(stage, 'RUNTIME.json'), manifest);await fs.rename(stage, runtime);
  const id = 'a'.repeat(64), imageId = 'sha256:' + 'b'.repeat(64), value = 'test-only-binding';
  const spec = { name:'sample-site-store', image:'example:one', labels:{'omnitron.project':'sample','omnitron.stack':'site',
    'omnitron.service':'store','omnitron.managed':'true'},environment:{KEY:{binding:'example:store'}} };
  const model=JSON.stringify({protocol:1,project:'sample',stack:'site',release:'approved',manifestSha256:'d'.repeat(64),services:[{originalId:id,imageId,spec}]});
  await fs.writeFile(path.join(area,'declaration.json'),model);await fs.writeFile(path.join(area,'options.json'),'{}');
  const docker=path.join(bin,'docker');
  await fs.writeFile(docker, '#!/bin/sh\ncase "$1" in\nimage) echo '+imageId+';;\nps) case "$*" in\n*omnitron.spec-hash-schema*) ;;\n*omnitron.spec-hash=*) case "$*" in *'+sha(value).slice(0,16)+'*) echo '+id+';; esac;;\n*) echo '+id+';;\nesac;;\n*) exit 1;; esac\n',{mode:0o755});
  const args=[path.join(helper,'source.mjs'),'review',path.join(area,'declaration.json'),sha(model),runtime,sha(manifest),path.join(area,'options.json')];
  const env={ ...process.env, PATH:bin+path.delimiter+process.env.PATH };
  const unsigned=spawnSync(process.execPath,args,{encoding:'utf8',env});
  assert.equal(unsigned.status,0,unsigned.stderr);assert.equal(JSON.parse(unsigned.stdout).services.store,'binding-required');
  const grant={protocol:1,project:'sample',stack:'site',declarationSha256:sha(model),bindings:{'example:store':value}};
  // fd 3 is a pipe from the approved provider. Neither argv nor an environment carries the value.
  const signed=spawnSync('/bin/sh',['-c','exec 3<&0; exec "$@"', 'retained-test',process.execPath,...args,'3'],{encoding:'utf8',env,input:JSON.stringify(grant)});
  assert.equal(signed.status,0,signed.stderr);assert.equal(JSON.parse(signed.stdout).eligible,true);
  assert(!signed.stdout.includes(value));assert(!signed.stderr.includes(value));
  await fs.appendFile(path.join(runtime,'packages/0/dist/infrastructure/container-runtime.js'),'\n// changed');
  const drift=spawnSync(process.execPath,args,{encoding:'utf8',env});assert.notEqual(drift.status,0);assert.equal(drift.stdout,'');
  reserveSourceSeal(area,{project:'sample',stack:'site'},'op','first');reserveSourceSeal(area,{project:'sample',stack:'site'},'op','first');
  assert.throws(()=>reserveSourceSeal(area,{project:'sample',stack:'site'},'op','second'));
});
