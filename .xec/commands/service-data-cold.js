import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { receiverProgram, serviceDataDefinition } from './service-data-preseed.js';
import { seedBootstrap } from './service-data-adopt.js';

const qualified = '1774d8587171e5481ba010493223470fdc6e737f858806dd4d9ae3238edde3ff';
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
const load = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));
const attest = `import base64,gzip,hashlib,json,subprocess,sys
for node,h in json.loads(gzip.decompress(base64.b64decode(sys.argv[1]))):
    p=subprocess.run(['omnitron','--json','pipeline','status',h['id'],'--output'],capture_output=True,timeout=60,check=True)
    v=json.loads(p.stdout);r=v.get('data',{})
    if v.get('ok') is not True or r.get('id')!=h['id'] or r.get('status')!='success' or (r.get('review') or {}).get('digest')!=h['review']:sys.exit('Seed bootstrap review changed')
    for name,digest in h['steps'].items():
        hits=[s for s in r['steps'] if s['name']==name]
        if len(hits)!=1:sys.exit('Seed bootstrap step changed')
        step=hits[0]
        if step.get('nodeId')!=node or step.get('status')!='success' or step.get('exitCode')!=0 or step.get('outputTruncated') is not False or hashlib.sha256(step['output'].encode()).hexdigest()!=digest:sys.exit('Seed helper attestation differs')
print('Both registered bootstrap runs attest the reviewed service helper.')`;

export async function retainedServiceDefinition(
  phase,
  spec,
  { sourceBootstrap, receiverBootstrap, stop, grants, receipt, warmIdleSeconds }
) {
  if (!['seed', 'cold', 'seal'].includes(phase)) throw Error('Expected a retained seed, cold or seal operation');
  const source = seedBootstrap(spec, sourceBootstrap, 'source');
  const receiver = seedBootstrap(spec, receiverBootstrap);
  const current = createHash('sha256')
    .update(await receiverProgram())
    .digest('hex');
  if (source.id === receiver.id || source.helper !== receiver.helper || ![qualified, current].includes(source.helper))
    throw Error('This historical service-data helper has not been qualified for the retained operation');
  const graph = await serviceDataDefinition(phase, spec, {
    grants,
    stop,
    receipt,
    warmIdleSeconds,
    installedDigest: source.helper,
  });
  const index = graph.steps.findIndex((s) => s.name === (phase === 'seed' ? 'check-receiver' : 'confirm-stop'));
  if (index < 1) throw Error('Missing native grant or stop gate');
  const gate = {
    name: 'registered-seed-helpers',
    dependsOn: graph.steps[index].dependsOn,
    retries: 0,
    timeout: 150000,
    run:
      '/usr/bin/python3 -I -c ' +
      quote(attest) +
      ' ' +
      gzipSync(
        JSON.stringify([
          [spec.sourceNode, source],
          [spec.receiverNode, receiver],
        ])
      ).toString('base64'),
  };
  graph.steps[index].dependsOn = [gate.name];
  graph.steps.splice(index, 0, gate);
  graph.name = 'service-data-' + spec.id + '-retained-' + phase;
  if (graph.steps.some((s) => Buffer.byteLength(s.run) > 22 * 1024))
    throw Error('Retained service command exceeds the SSH management budget');
  return graph;
}

export { retainedServiceDefinition as retainedColdDefinition };

export function command(program) {
  const entry = program
    .command('service-data-cold')
    .description('Cold-check and seal service data under the already registered endpoint grants');
  for (const phase of ['cold', 'seal']) {
    const cmd = entry
      .command(phase + ' <spec>')
      .requiredOption('--source-bootstrap <file>', 'Original successful source bootstrap Pipeline')
      .requiredOption('--receiver-bootstrap <file>', 'Original successful receiver bootstrap Pipeline')
      .requiredOption('--stop <uuid>', 'Confirmed full source stack stop');
    if (phase === 'cold') cmd.requiredOption('--grants <file>', 'Admitted source and receiver grants');
    else cmd.requiredOption('--cold <file>', 'Completed source cold receipt');
    cmd.action(async (file, o) => {
      const graph = await retainedServiceDefinition(phase, await load(file), {
        sourceBootstrap: await load(o.sourceBootstrap),
        receiverBootstrap: await load(o.receiverBootstrap),
        stop: o.stop,
        grants: o.grants ? await load(o.grants) : undefined,
        receipt: o.cold ? await load(o.cold) : undefined,
      });
      await new Promise((resolve, reject) =>
        process.stdout.write(JSON.stringify(graph, null, 2) + '\n', (e) => (e ? reject(e) : resolve()))
      );
    });
  }
}
