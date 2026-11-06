import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { cleanupFixture } from './fixture-cleanup.mjs';

// Uses the ordinary resident owner, bootstrap compiler, Netron DI and watcher.
// All application sources, sockets, databases and processes belong to this fixture.
const dist = path.resolve(process.argv[2]);
const load = name => import(pathToFileURL(path.join(dist, name + '.js')));
const { ExecutionClient } = await load('daemon/execution-client');
const { DEFAULT_ECOSYSTEM, DEFAULT_DAEMON_CONFIG } = await load('config/defaults');
const { OWN_BUILD } = await load('shared/build-stamp');
const { resolveInstalledDependency } = await load('release/package-resolution');
const applicationSdkArg = process.argv.indexOf('--application-sdk');
const sdk = await fs.realpath(applicationSdkArg === -1 ? path.dirname(dist) : process.argv[applicationSdkArg + 1]);
const titan = await resolveInstalledDependency(sdk, '@omnitron-dev/titan');
assert.ok(titan, 'Application SDK must resolve its own Titan');
const nextSdkArg = process.argv.indexOf('--next-application-sdk');
const nextSdk = nextSdkArg === -1 ? undefined : await fs.realpath(process.argv[nextSdkArg + 1]);
const nextTitan = nextSdk && await resolveInstalledDependency(nextSdk, '@omnitron-dev/titan');
if (nextSdk) {
  assert.ok(nextTitan, 'Next application SDK must resolve its own Titan');
  assert.notEqual(await fs.realpath(nextTitan), await fs.realpath(titan), 'The SDK transition must change physical Titan identity');
}
const directory = await fs.mkdtemp('/private/tmp/omni-watch-');
const observed = path.join(directory, 'observed.jsonl');
const config = { ...DEFAULT_ECOSYSTEM, apps: [] };
const sources = new Map();
const change = (name, version) => fs.writeFile(sources.get(name), `
function Tagged<T extends new (...args: any[]) => any>(target:T):T{return target;}
@Tagged class Value { constructor(public readonly value:string){} }
export const current=new Value(${JSON.stringify(name + '-' + version)});
`);
for (const name of ['first', 'second']) {
  const project = path.join(directory, name), app = path.join(project, 'apps/probe');
  const kit = path.join(project, 'packages/kit');
  for (const part of [app + '/src', kit + '/src', project + '/node_modules/@fixture', project + '/node_modules/@omnitron-dev'])
    await fs.mkdir(part, { recursive: true });
  await fs.symlink(kit, project + '/node_modules/@fixture/kit');
  await fs.symlink(sdk, project + '/node_modules/@omnitron-dev/omnitron');
  await fs.symlink(titan, project + '/node_modules/@omnitron-dev/titan');
  await fs.writeFile(project + '/package.json', JSON.stringify({ name, type: 'module' }));
  await fs.writeFile(app + '/package.json', JSON.stringify({ name: 'fixture-' + name, type: 'module' }));
  await fs.writeFile(kit + '/package.json', JSON.stringify({ name: '@fixture/kit', type: 'module', exports: { '.': { import: './src/index.ts' } } }));
  await fs.writeFile(kit + '/src/index.ts', "export {current} from './value.js';\n");
  sources.set(name, kit + '/src/value.ts'); await change(name, 'initial');
  await fs.writeFile(app + '/src/bootstrap.ts', `import {defineSystem} from '@omnitron-dev/omnitron/config';
import {current} from '@fixture/kit';
export default defineSystem({name:current.value,version:'1.0.0',processes:[
 {name:'provider',module:'./provider.ts',topology:{expose:true}},
 {name:'consumer',module:'./consumer.ts',topology:{access:['FixtureWorker']}}
]});`);
  await fs.writeFile(app + '/src/provider.ts', `import fs from 'node:fs';
import {createRequire} from 'node:module';
import {Module,Service,Public} from '@omnitron-dev/titan/decorators';
import {current} from '@fixture/kit';
class Worker {snapshot(){return {value:current.value,pid:process.pid,parent:process.ppid,
 titan:fs.realpathSync(createRequire(import.meta.url).resolve('@omnitron-dev/titan')),
 adapter:fs.realpathSync((globalThis as any).workerData.processPath)};}}
Public()(Worker.prototype,'snapshot',Object.getOwnPropertyDescriptor(Worker.prototype,'snapshot'));
Service({name:'FixtureWorker'})(Worker);
class Provider {} Module({providers:[Worker],exports:[Worker]})(Provider);export default Provider;`);
  await fs.writeFile(app + '/src/consumer.ts', `import fs from 'node:fs';
import {Module} from '@omnitron-dev/titan/decorators';
import {Container,createToken} from '@omnitron-dev/titan/nexus';
let timer;class Consumer {onDestroy(){clearInterval(timer);}}
Module({providers:[[createToken('fixture-observer'),{inject:[Container],useFactory:(container)=>{
 let pending=false;timer=setInterval(async()=>{if(pending)return;pending=true;let result;
 try{result=await container.resolve(createToken('topology:FixtureWorker')).snapshot();}
 catch(error){result={error:String(error)};}
 fs.appendFileSync(${JSON.stringify(observed)},JSON.stringify({observer:${JSON.stringify(name)},consumerPid:process.pid,at:Date.now(),...result})+'\\n');pending=false;
 },150);return {observer:${JSON.stringify(name)}};
}}]]})(Consumer);export default Consumer;`);
  const registered = path.join(directory, 'operator/deep/internal', name);
  await fs.mkdir(path.dirname(registered), { recursive: true });
  await fs.symlink(project, registered);
  config.apps.push({ name: name + '/dev/probe', cwd: path.join(registered, 'apps/probe'),
    bootstrap: 'src/bootstrap.ts', enabled: true, watch: 'src', restartPolicy: { enabled: false } });
}
const execution = path.join(directory, 'e'); await fs.mkdir(execution, { mode: 0o700 });
const boot = path.join(directory, 'boot.json');
await fs.writeFile(boot, JSON.stringify({ directory: execution, cwd: directory, config,
  daemonConfig: { ...DEFAULT_DAEMON_CONFIG, logDir: path.join(directory, 'logs') } }), { mode: 0o600 });
const output = await fs.open(path.join(directory, 'owner.log'), 'a', 0o600);
const owner = fork(path.join(dist, 'daemon/execution-entry.js'), [boot], {
  cwd: directory, execArgv: [], detached: true, stdio: ['ignore', output.fd, output.fd, 'ipc'],
  env: { PATH: process.env.PATH, TMPDIR: directory, OMNITRON_HOME: directory, OMNITRON_NO_INFRA: '1', NODE_OPTIONS: '', NODE_PATH: '' },
});
await output.close();
const exited = once(owner, 'exit');
const logger = { trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return this; } };
const client = new ExecutionClient(path.join(execution, 'owner.sock'), logger);
const rows = async () => { try { return (await fs.readFile(observed, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; } };
async function until(check, label, timeout = 60_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await check(); if (value) return value; await delay(100); }
  throw Error(label + '; inspect ' + directory);
}
let connected = false, primaryFailure;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Private owner boot timed out')), 30_000);
    owner.once('error', error => { clearTimeout(timer); reject(error); });
    owner.once('exit', code => { clearTimeout(timer); reject(Error('Private owner exited ' + code)); });
    owner.once('message', message => { clearTimeout(timer); assert.equal(message.type, 'execution-ready'); resolve(); });
  });
  const snapshot = await client.connect(); connected = true;
  assert.equal(snapshot.ownerBuild.commit, OWN_BUILD.commit);
  assert.equal(snapshot.capabilities.applicationTopology, 1);
  if (nextSdk) assert.equal(snapshot.capabilities.applicationRuntimeResolution, 1);
  await client.acquire(); client.orchestrator.devMode = true;
  for (const entry of config.apps) await client.orchestrator.startApp(entry, config);
  const initial = {};
  for (const name of sources.keys()) initial[name] = await until(async () => (await rows()).find(row => row.value === name + '-initial'), name + ' initial RPC');
  await until(async () => { await client.refresh(); return client.orchestrator.getBuildWatchedApps().length === 2; }, 'Both applications watched');
  await change('first', 'updated');
  const changed = await until(async () => (await rows()).find(row => row.value === 'first-updated'), 'Shared-library watch restart');
  assert.notEqual(changed.pid, initial.first.pid);
  assert.notEqual(changed.consumerPid, initial.first.consumerPid);
  assert.equal(changed.parent, owner.pid);
  const unaffected = await until(async () => (await rows()).find(row => row.observer === 'second' && row.at > changed.at), 'Unrelated application continuity');
  assert.equal(unaffected.pid, initial.second.pid); assert.equal(unaffected.consumerPid, initial.second.consumerPid);
  assert.equal(unaffected.value, 'second-initial');
  for (const row of await rows()) if (row.value) assert.ok(row.value.startsWith(row.observer + '-'), 'A sibling call escaped its application');
  await client.orchestrator.setWatchMode(false);
  await client.orchestrator.stopApp('first/dev/probe');
  const stoppedAt = Date.now();
  const survivor = await until(async () => (await rows()).find(row => row.observer === 'second' && row.at > stoppedAt), 'Surviving topology after stop');
  assert.equal(survivor.pid, initial.second.pid); assert.equal(survivor.value, 'second-initial');
  const sdkTransitions = [];
  if (nextSdk) {
    // Keep the owner's loader history and the application's absolute bootstrap
    // path. Only the stopped fixture's normal dependency links change.
    for (const [phase, selectedSdk, selectedTitan] of [['upgrade', nextSdk, nextTitan], ['rollback', sdk, titan]]) {
      await client.orchestrator.stopApp('first/dev/probe');
      for (const [name, target] of [['omnitron', selectedSdk], ['titan', selectedTitan]]) {
        const link = path.join(directory, 'first/node_modules/@omnitron-dev', name);
        await fs.unlink(link); await fs.symlink(target, link, 'dir');
      }
      const after = Date.now();
      await client.orchestrator.restartApp('first/dev/probe');
      const current = await until(async () => (await rows()).find(row => row.observer === 'first' && row.at >= after && row.value === 'first-updated'), phase + ' RPC');
      assert.ok(current.titan.startsWith(await fs.realpath(selectedTitan) + path.sep));
      assert.equal(current.adapter, await fs.realpath(path.join(selectedSdk, 'dist/orchestrator/bootstrap-process.js')));
      assert.equal(current.parent, owner.pid);
      const previous = sdkTransitions.at(-1)?.current ?? changed;
      assert.notEqual(current.pid, previous.pid); assert.notEqual(current.consumerPid, previous.consumerPid);
      const sibling = await until(async () => (await rows()).find(row => row.observer === 'second' && row.at > current.at), phase + ' unrelated RPC');
      assert.equal(sibling.pid, initial.second.pid); assert.equal(sibling.consumerPid, initial.second.consumerPid);
      sdkTransitions.push({ phase, sdk: selectedSdk, current, sibling });
    }
  }
  console.log(JSON.stringify({ test: 'development-topology-watch', commit: OWN_BUILD.commit,
    applicationSdk: JSON.parse(await fs.readFile(path.join(sdk, 'dist/BUILD.json'), 'utf8')).commit,
    ownerPid: owner.pid, initial, changed, survivor, sdkTransitions, sourceSymlinks: true, sameNamesIsolated: true, productionChanged: false }));
} catch (error) { primaryFailure = { error }; }
finally {
  await cleanupFixture(directory, primaryFailure, async attempt => {
    if (connected) await attempt('owned applications', async () => { await client.orchestrator.setWatchMode(false); await client.orchestrator.stopAll(false); await client.shutdownOwner(); });
    await attempt('client', () => client.close());
    if (owner.exitCode === null && owner.signalCode === null) owner.kill('SIGTERM');
    await attempt('owner exit', () => Promise.race([exited, delay(35_000, undefined, { ref: false }).then(() => { throw Error('Private owner did not exit'); })]));
  });
}
await fs.rm(directory, { recursive: true, force: true });
