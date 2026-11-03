/** Build, transfer, bind and launch a sealed application with no package manager on the target. */
import assert from 'node:assert/strict';
import { exec as execCb, execFile as execFileCb } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
const exec = promisify(execCb), execFile = promisify(execFileCb);
const dist = path.resolve(process.argv[2] ?? 'dist');
const load = name => import(pathToFileURL(path.join(dist, 'release', name + '.js')));
const { installedGraph, materializeGraph } = await load('installed-graph');
const { ArtifactBuilder } = await import(pathToFileURL(path.join(dist, 'project/artifact-builder.js')));
const { stageApplicationClosure, bindApplicationCommand } = await load('application-closure');
const { writePortableArchive } = await load('portable-archive');
const { sealReleaseArtifactCommand, installedReleaseCheckCommand, verifyLaunchRelease } = await load('runtime-provenance');
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-closure-test-'));
const src = path.join(tmp,'clean'), root = path.join(tmp,'incoming'), owner = path.join(tmp,'owner');
const sha = value => createHash('sha256').update(value).digest('hex');
const run = async cmd => (await exec(cmd,{timeout:30_000})).stdout.trim();
const pkg = async (name, deps = {}, code = 'export default 42;') => {
  const dir = path.join(src,name.split('/').at(-1));
  await fs.mkdir(path.join(dir,'dist'),{recursive:true});
  await fs.writeFile(path.join(dir,'package.json'),JSON.stringify({name,version:'1.0.0',type:'module',exports:'./dist/index.js',files:['dist'],dependencies: Object.fromEntries(Object.keys(deps).map(n=>[n,'workspace:*']))}));
  await fs.writeFile(path.join(dir,'dist/index.js'),code);
  for(const [n,child] of Object.entries(deps)){const f=path.join(dir,'node_modules',n);await fs.mkdir(path.dirname(f),{recursive:true});await fs.symlink(child,f);}
  return dir;
};
try {
  const leaf=await pkg('mock-native'), titan=await pkg('@omnitron-dev/titan',{'mock-native':leaf},"export { default } from 'mock-native';");
  const extension = await pkg('@omnitron-dev/extension', {'@omnitron-dev/titan':titan, 'mock-native':leaf});
  const events = await pkg('@omnitron-dev/events', {'mock-native':leaf});
  const app=await pkg('sample-api',{'@omnitron-dev/titan':titan,'@omnitron-dev/extension':extension,'@omnitron-dev/events':events,'mock-native':leaf},"import n from '@omnitron-dev/titan';console.log(n);");
  const unused=await pkg('@omnitron-dev/unused');
  const daemon=await pkg('@omnitron-dev/omnitron',{'@omnitron-dev/titan':titan,'@omnitron-dev/events':events,'@omnitron-dev/unused':unused});
  await fs.writeFile(path.join(leaf,'dist/native.bin'),Buffer.from([0,16,255]));
  await fs.writeFile(path.join(app,'.env'),'NOT_FOR_RELEASE=1');
  const graph=await installedGraph(daemon),locations=graph.map((_,i)=>path.join(owner,'packages',String(i)));
  await materializeGraph(graph,locations);
  const ownerPkg=locations[0],options='--max-old-space-size=8192', cfg={name:'api',env:{NODE_OPTIONS:options}};
  // Execute the launch check from the package that the fixture owner actually serves.
  for (const file of ['release/runtime-provenance.js', 'release/package-resolution.js', 'release/target-runtime.js', 'shared/shell-escape.js']) {
    const out = path.join(ownerPkg, 'dist', file);
    await fs.mkdir(path.dirname(out), {recursive:true});
    await fs.copyFile(path.join(dist, file), out);
  }
  const live = await import(pathToFileURL(path.join(ownerPkg, 'dist/release/runtime-provenance.js')));
  // A working checkout can supply imports from its workspace root that its release does not ship.
  const missing = await pkg('undeclared-api');
  await fs.writeFile(path.join(missing, 'dist/bootstrap.js'), "import '@omnitron-dev/titan';");
  const ambientTitan = path.join(src, 'node_modules/@omnitron-dev/titan');
  await fs.mkdir(path.dirname(ambientTitan), { recursive: true });
  await fs.symlink(titan, ambientTitan, 'dir');
  const builder = new ArtifactBuilder(src, path.join(tmp, 'archives'));
  const pack = { skipBuild: true, releaseCheckouts: [src] };
  await assert.rejects(builder.buildApp({ name: 'undeclared-api', cwd: missing, bootstrap: 'dist/bootstrap.js' }, pack),
    /Bootstrap application undeclared-api must declare @omnitron-dev\/titan/);
  const brokenTitan = await pkg('broken-titan');
  await fs.writeFile(path.join(brokenTitan, 'package.json'), JSON.stringify({ name: '@omnitron-dev/titan', version: '1.0.0', exports: './dist/missing.js' }));
  const broken = await pkg('broken-api', { '@omnitron-dev/titan': brokenTitan });
  await fs.writeFile(path.join(broken, 'dist/bootstrap.js'), "import '@omnitron-dev/titan';");
  await assert.rejects(builder.buildApp({ name: 'broken-api', cwd: broken, bootstrap: 'dist/bootstrap.js' }, pack), { code: 'MODULE_NOT_FOUND' });
  assert.deepEqual(await fs.readdir(path.join(tmp, 'archives')), []);
  // A classic Node script can have an empty production graph.
  await builder.buildApp({ name: 'plain-script', cwd: missing, script: 'dist/index.js' }, pack);

  const staged=path.join(tmp,'stage'); await stageApplicationClosure(app,staged,{...cfg, bootstrap: 'dist/index.js'},[src]);
  assert.equal(await fs.access(path.join(staged,'.env')).then(()=>true,()=>false),false);
  await assert.rejects(stageApplicationClosure(app,path.join(tmp,'inject'),{name:'api',env:{NODE_OPTIONS:'--require=/tmp/evil.cjs'}},[src]),/permits only/);
  await assert.rejects(stageApplicationClosure(app,path.join(tmp,'outside'),cfg,[app]),/escapes the frozen/);
  const globalModules = path.join(tmp,'ambient-modules');
  await fs.mkdir(globalModules); await fs.symlink(leaf, path.join(globalModules,'mock-native'), 'dir');
  const resolution = pathToFileURL(path.join(dist,'release/package-resolution.js')).href;
  const probe = 'const {resolveInstalledDependency}=await import(process.argv[1]);' +
    'if(await resolveInstalledDependency(process.argv[2],"mock-native"))process.exitCode=1;';
  await execFile(process.execPath, ['--input-type=module','-e',probe,resolution,tmp], {env:{...process.env,NODE_PATH:globalModules}});
  const archive=path.join(tmp,'sample.tar.gz');await writePortableArchive(staged,archive);
  await fs.mkdir(root);await execFile('tar',['-xzf',archive,'-C',root]);
  const content=await fs.readFile(archive),bootstrap=path.join(root,'dist/index.js'),closure=path.join(root,'.omnitron-closure.json');
  const record=await fs.readFile(closure,'utf8'), spec=JSON.parse(record);
  const transferred = 'api-1.0.0.tar.gz';
  await fs.copyFile(archive,path.join(root,transferred));
  const binding=bindApplicationCommand(root,ownerPkg,process.execPath,transferred);
  const send=async edit=>fs.writeFile(closure,JSON.stringify(edit));
  await send({...spec,runtime:{...spec.runtime,arch:'wrong-arch'}});await assert.rejects(run(binding),/runtime mismatch \(arch\)/);await fs.writeFile(closure,record);
  const payload=await fs.readFile(bootstrap);await fs.appendFile(bootstrap,'changed');await assert.rejects(run(binding),/unpacked release payload/);await fs.writeFile(bootstrap,payload);
  const remoteLeaf=path.join(locations[graph.findIndex(p=>p.metadata.name==='mock-native')],'dist/native.bin');
  const native=await fs.readFile(remoteLeaf);await fs.writeFile(remoteLeaf,Buffer.from([42]));await assert.rejects(run(binding),/owner dependencies differ/);await fs.writeFile(remoteLeaf,native);
  const eventLeaf = path.join(await fs.realpath(path.join(ownerPkg, 'node_modules/@omnitron-dev/events')), 'node_modules/mock-native');
  const originalLink = await fs.readlink(eventLeaf), duplicate = path.join(owner, 'duplicate');
  await fs.cp(await fs.realpath(eventLeaf), duplicate, {recursive:true});
  await fs.unlink(eventLeaf); await fs.symlink(duplicate, eventLeaf, 'dir');
  await assert.rejects(run(binding), /shared package identity differs/);
  await fs.unlink(eventLeaf); await fs.symlink(originalLink, eventLeaf, 'dir');
  assert.equal(JSON.parse(await run(binding)),options);assert.equal(await fs.realpath(path.join(root,'node_modules/@omnitron-dev/titan')),await fs.realpath(path.join(ownerPkg,'node_modules/@omnitron-dev/titan')));
  const expectedLeaf = await fs.realpath(path.dirname(path.dirname(remoteLeaf)));
  for (const installed of ['node_modules/mock-native', 'node_modules/@omnitron-dev/extension/node_modules/mock-native',
    'node_modules/@omnitron-dev/titan/node_modules/mock-native']) {
    assert.equal(await fs.realpath(path.join(root, installed)), expectedLeaf, installed);
  }
  assert.ok((await fs.realpath(path.join(root, 'node_modules/@omnitron-dev/extension'))).startsWith(root + path.sep));
  assert.equal(await fs.access(path.join(root,'node_modules/@omnitron-dev/unused')).then(()=>true,()=>false),false);
  assert.equal((await execFile(process.execPath,[bootstrap],{env:{NODE_OPTIONS:options}})).stdout.trim(),'42');
  assert.equal(await fs.access(path.join(root,transferred)).then(()=>true,()=>false),false);
  const origin={releaseId:'sample-1',app:'api',manifestSha256:'a'.repeat(64),artifactSha256:sha(content),artifactBytes:content.length,frameworkCommit:'c'.repeat(40)};
  const runtime={root:ownerPkg,executable:process.execPath,commit:origin.frameworkCommit};
  await run(sealReleaseArtifactCommand(root,origin,origin.frameworkCommit,true,true,{nodeOptions:options,executable:runtime.executable,ownerPackage:runtime.root}));
  const check=(e, verifier = live.verifyLaunchRelease)=>verifier({name:'project/test/api',cwd:root,releaseRoot:root,bootstrap,env:e},'launch-1',[bootstrap]);
  assert.equal((await check({NODE_OPTIONS:options})).state,'confirmed');
  for(const env of [{NODE_OPTIONS:'--max-old-space-size=4096'},{NODE_OPTIONS:'--require=/tmp/payload'},{NODE_OPTIONS:options,NODE_PATH:'/tmp'},{NODE_OPTIONS:''}])assert.equal((await check(env)).state,'unreported');
  assert.equal((await check({NODE_OPTIONS:options}, verifyLaunchRelease)).state, 'modified');
  const reuse=installedReleaseCheckCommand(root,origin,runtime,options);
  assert.equal(await run(installedReleaseCheckCommand(root,origin,runtime,'')),'stale');
  assert.equal(await run(reuse),'verified');assert.equal(await run(installedReleaseCheckCommand(root,{...origin,releaseId:'another'},runtime,options)),'stale');
  assert.equal(await run(installedReleaseCheckCommand(root,origin,{...runtime,root:path.join(tmp,'different-owner')},options)),'stale');
  await fs.appendFile(bootstrap,'\n// changed');assert.equal(await run(reuse),'stale');assert.equal((await check({NODE_OPTIONS:options})).state,'modified');
  console.log(JSON.stringify({test:'frozen-application',offlineLaunch:true,matchingSharedIdentity:true,alteredNativeBytesRefused:true,resourcePolicyVerified:true,reuseChecks:true}));
} finally {await fs.rm(tmp,{recursive:true,force:true});}
