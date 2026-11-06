import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Public stack lifecycle with real source bootstrap, pools and a retained archive.
 * Shares the managed-owner fixture's native services, cleanup and cold transitions.
 * This fixture's syntax gate is not qualification of a production application.
 */
export async function prepareManagedProjectRuntime(context) {
  const { root, instance, applicationSdk, managementDist, candidate, runtime, api, run, until, track, mark } = context;
  const load = name => import(pathToFileURL(path.join(managementDist, name + '.js')).href);
  const { ArtifactBuilder } = await load('project/artifact-builder');
  const { resolveInstalledDependency } = await load('release/package-resolution');
  const { targetRuntime } = await load('release/target-runtime');
  const { loadRelease } = await load('release/load');
  const { verifyRuntimeArtifact } = await load('shared/runtime-artifact');
  const { PidManager } = await load('daemon/pid-manager');
  const sdk = await fs.realpath(applicationSdk);
  const sdkBuild = JSON.parse(await fs.readFile(path.join(sdk, 'dist/BUILD.json'), 'utf8'));
  assert.equal(sdkBuild.commit, candidate.build.commit, 'Qualify the exact candidate SDK');
  const project = path.join(root, 'applications'), app = path.join(project, 'app');
  const observations = path.join(root, 'application-runtime.jsonl');
  for (const directory of ['src', 'dist', 'node_modules/@omnitron-dev'])
    await fs.mkdir(path.join(app, directory), { recursive: true });
  const dependencies = {};
  for (const name of ['@omnitron-dev/omnitron', '@omnitron-dev/titan', '@omnitron-dev/titan-storage']) {
    const dependency = name === '@omnitron-dev/omnitron' ? sdk : await resolveInstalledDependency(sdk, name);
    assert.ok(dependency, 'The application SDK must provide ' + name);
    const real = await fs.realpath(dependency);
    await fs.symlink(real, path.join(app, 'node_modules', name), 'dir');
    dependencies[name] = JSON.parse(await fs.readFile(path.join(real, 'package.json'), 'utf8')).version;
  }
  await fs.writeFile(path.join(app, 'package.json'), JSON.stringify({ name: 'managed-runtime-fixture',
    version: '1.0.0', type: 'module', files: ['dist'], dependencies }));
  await fs.writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'managed-project-fixture', private: true, type: 'module' }));
  await fs.writeFile(path.join(project, '.gitignore'), 'node_modules/\n.omnitron-build/\napplication-state-*.txt\n');
  const declarationFile = path.join(project, 'policy.mjs');
  const declaration = "export const policy = { type:'local', apps:'all', infrastructureOwnership:'external' };\n";
  await fs.writeFile(declarationFile, declaration);
  await fs.writeFile(path.join(project, 'omnitron.config.mjs'), `import {policy} from './policy.mjs';
export default {project:'applications',stacks:{dev:{...policy},frozen:{...policy,watch:false,release:{mode:'required',requiredGates:['syntax']}}},
apps:[{name:'runtime',cwd:'./app',bootstrap:'src/bootstrap.ts',watch:'src',env:{RUNTIME_PROOF:${JSON.stringify(observations)}},restartPolicy:{enabled:false}}]};\n`);
  const bootstrap = extension => `import {defineSystem} from '@omnitron-dev/omnitron/config';
export default defineSystem({name:'runtime',version:'1.0.0',processes:[
{name:'single',module:'./single.${extension}'},{name:'pool',module:'./pool.${extension}',instances:2}]});\n`;
  for (const [folder, extension] of [['src', 'ts'], ['dist', 'js']]) {
    await fs.writeFile(path.join(app, folder, 'bootstrap.' + extension), bootstrap(extension));
    await fs.writeFile(path.join(app, folder, 'value.' + extension), "export const value = 'initial';\n");
    for (const role of ['single', 'pool']) await fs.writeFile(path.join(app, folder, role + '.' + extension), `
import fs from 'node:fs';
import {Module,Inject,Injectable} from '@omnitron-dev/titan/decorators';
import {ConfigModule} from '@omnitron-dev/titan/module/config';
import {LoggerModule} from '@omnitron-dev/titan/module/logger';
import {LocalAdapter} from '@omnitron-dev/titan-storage';
import {RUNTIME_CONTEXT} from '@omnitron-dev/omnitron/runtime';
import {value} from './value.${extension}';
class Probe {
  constructor(adapter,context){this.adapter=adapter;this.context=context;}
  onInit(){
    if(this.context.state!=='verified')fs.writeFileSync('application-state-'+process.pid+'.txt',value);
    const record=()=>fs.appendFileSync(process.env.RUNTIME_PROOF,JSON.stringify({at:Date.now(),pid:process.pid,parent:process.ppid,
      cwd:process.cwd(),module:import.meta.url,stack:process.env.OMNITRON_STACK,role:${JSON.stringify(role)},value,context:this.context})+'\\n');
    record();this.timer=setInterval(record,200);this.timer.unref();
  }
  onDestroy(){clearInterval(this.timer);}
}
Inject(LocalAdapter)(Probe,undefined,0);Inject(RUNTIME_CONTEXT)(Probe,undefined,1);Injectable()(Probe);
class RuntimeModule {}
Module({imports:[ConfigModule.forRoot({defaults:{storage:{local:{basePath:'./data/storage'}}}}),LoggerModule.forRoot({level:'error'})],
providers:[LocalAdapter,Probe]})(RuntimeModule);export default RuntimeModule;
`);
  }
  for (const entry of ['bootstrap', 'single', 'pool', 'value'])
    await run(process.execPath, ['--check', path.join(app, 'dist', entry + '.js')]);
  const git = (...args) => run('git', args, { cwd: project, timeout: 20_000 });
  await git('init', '--quiet');
  await git('add', '.');
  await git('-c', 'user.name=Omnitron fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgsign=false',
    'commit', '--quiet', '-m', 'Record native application fixture');
  const commit = (await git('rev-parse', 'HEAD')).stdout.trim();
  const manifestBlob = (await git('rev-parse', 'HEAD:app/package.json')).stdout.trim();
  const releaseId = 'native-application-fixture';
  const releaseRoot = path.join(instance, 'releases', releaseId);
  const built = await new ArtifactBuilder(project, path.join(releaseRoot, 'artifacts')).buildApp(
    { name: 'runtime', cwd: app, bootstrap: 'dist/bootstrap.js' },
    { skipBuild: true, releaseCheckouts: [project, path.resolve(sdk, '../../..')] });
  const manifest = { id: releaseId, project: { repo: project, commit, onRemote: false },
    omni: { repo: sdk, commit: sdkBuild.commit, onRemote: null },
    artifacts: [{ app: 'runtime', version: built.version, sha256: built.tarballSha256, bytes: built.size, launch: built.launch,
      packageSource: { directory: 'app', manifestBlob, migrations: {} } }],
    gates: [{ name: 'syntax', status: 'passed', checks: 4, detail: 'node --check on the four fixture JavaScript entries' }],
    builtWith: { omnitron: JSON.parse(await fs.readFile(path.join(sdk, 'package.json'), 'utf8')).version,
      packages: [], target: await targetRuntime() }, builtAt: new Date().toISOString() };
  const manifestBytes = JSON.stringify(manifest);
  const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
  await fs.writeFile(path.join(releaseRoot, 'manifest.json'), manifestBytes);
  assert.equal((await loadRelease(releaseId, path.dirname(releaseRoot))).manifestSha256, manifestSha256);
  await verifyRuntimeArtifact(runtime, candidate.id);
  const unchangedSince = Date.now();
  const call = (method, args) => api(async client => (await client.service('OmnitronProject'))[method]({ project: 'applications', ...args }));
  await call('addProject', { name: 'applications', path: project });
  const prepared = await call('checkRelease', { stack: 'frozen', release: releaseId, prepare: true });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  mark({ stage: 'application-runtime-prepared', release: releaseId, manifestSha256 });
  const report = { source: commit, framework: sdkBuild.commit, release: releaseId, manifestSha256, phases: [] };
  let active = [], previous;
  const rows = async () => {
    try { return (await fs.readFile(observations, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  const ready = async (stack, ownerPid, since, value) => until(async () => {
    const current = new Map((await rows()).filter(row => row.stack === stack && row.parent === ownerPid && row.at >= since && row.value === value)
      .map(row => [row.pid, row]));
    const observed = [...current.values()].filter(row => PidManager.isProcessAlive(row.pid));
    if (observed.length !== 3) return false;
    assert.equal(observed.filter(row => row.role === 'single').length, 1);
    assert.equal(observed.filter(row => row.role === 'pool').length, 2);
    for (const row of observed) {
      track(row.pid);
      if (stack === 'dev') {
        assert.equal(await fs.realpath(row.cwd), app);
        assert.equal(await fs.readFile(path.join(app, 'application-state-' + row.pid + '.txt'), 'utf8'), value);
      } else {
        assert.equal(row.context.state, 'verified');
        assert.equal(row.context.basis, 'verified-installed-runtime');
        assert.equal(row.context.producer.manifestSha256, manifestSha256);
        assert.equal(row.context.producer.frameworkCommit, sdkBuild.commit);
        // A locally pinned release retains the declared working directory;
        // executable modules and their dependency graph come from the archive.
        assert.equal(await fs.realpath(row.cwd), app);
        assert.ok(fileURLToPath(row.module).startsWith(path.join(instance, 'releases', '.installed') + path.sep),
          'Frozen executable must come from its verified installation');
      }
      await assert.rejects(fs.lstat(path.join(row.cwd, 'data/storage')), { code: 'ENOENT' });
    }
    const info = await call('getStack', { stack });
    assert.equal(info.apps.length, 1);
    assert.equal(info.apps[0].status, 'online');
    if (stack === 'frozen') {
      assert.equal(info.selectedRelease.id, releaseId);
      assert.equal(info.selectedRelease.manifestSha256, manifestSha256);
      assert.equal(info.apps[0].release.state, 'confirmed');
    }
    return observed;
  }, `Public ${stack} single/pool workers did not become ready`);
  return {
    async start(ownerPid, cold) {
      if (cold) {
        for (const stack of ['dev', 'frozen']) {
          const stopped = await call('getStack', { stack });
          assert.equal(stopped.status, 'stopped');
          assert.ok(stopped.apps.every(app => app.status !== 'online'));
          if (stack === 'frozen') assert.equal(stopped.selectedRelease.manifestSha256, manifestSha256);
        }
        try {
          await fs.writeFile(declarationFile, declaration + '// deliberate tracked declaration drift\n');
          const refused = await call('checkRelease', { stack: 'frozen', release: releaseId });
          assert.equal(refused.ok, false);
          assert.match(refused.because, /policy\.mjs/);
          await assert.rejects(call('startStack', { stack: 'frozen' }), /policy\.mjs/);
          assert.ok((await call('getStack', { stack: 'frozen' })).apps.every(app => app.status !== 'online'),
            'A refused release must not start any application');
          report.declarationDriftRefused = true;
        } finally { await fs.writeFile(declarationFile, declaration); }
        const admitted = await call('checkRelease', { stack: 'frozen', release: releaseId });
        assert.equal(admitted.ok, true, JSON.stringify(admitted));
      }
      const since = Date.now();
      // Slave fixtures default to no watch. Exercise its explicit public control,
      // rather than changing an execution-owner field behind the daemon's back.
      await api(client => client.enableWatch({ apps: ['applications/dev/runtime'] }));
      mark({ stage: 'source-stack-starting', cold, ownerPid });
      await call('startStack', { stack: 'dev', workingTree: true });
      // The second launch must recover the persisted selection, without resupplying its ID.
      mark({ stage: 'archive-stack-starting', cold, ownerPid });
      await call('startStack', { stack: 'frozen', ...(cold ? {} : { release: releaseId }) });
      let development = await ready('dev', ownerPid, since, cold ? 'updated' : 'initial');
      const frozen = await ready('frozen', ownerPid, since, 'initial');
      await until(async () => {
        const watch = await api(client => client.getWatchStatus());
        return watch.enabled && watch.apps.some(app => app.name === 'applications/dev/runtime') &&
          !watch.apps.some(app => app.name === 'applications/frozen/runtime');
      }, 'Public watcher must include only source applications');
      if (!cold) {
        const changedAt = Date.now();
        await fs.writeFile(path.join(app, 'src/value.ts'), "export const value = 'updated';\n");
        const updated = await ready('dev', ownerPid, changedAt, 'updated');
        for (const row of development) {
          assert.ok(!updated.some(next => next.pid === row.pid));
          await until(() => !PidManager.isProcessAlive(row.pid), 'Previous development worker survived watch restart');
        }
        development = updated;
        const unchanged = await ready('frozen', ownerPid, changedAt, 'initial');
        assert.deepEqual(unchanged.map(row => row.pid).sort(), frozen.map(row => row.pid).sort());
        report.watchPreservedFrozenWorkers = true;
        mark({ stage: 'source-watch-verified', ownerPid, sourceWorkers: updated.length, frozenWorkers: unchanged.length });
      }
      active = [...development, ...frozen];
      if (previous) for (const row of active) assert.ok(!previous.includes(row.pid), 'Cold start reused a previous worker');
      report.phases.push({ cold, ownerPid, development: development.map(({ pid, cwd, role }) => ({ pid, cwd, role })),
        frozen: frozen.map(({ pid, cwd, role }) => ({ pid, cwd, role })) });
      await verifyRuntimeArtifact(runtime, candidate.id, unchangedSince);
      mark({ stage: 'application-runtime-verified', cold, ownerPid, workers: active.length });
    },
    async stop() {
      for (const stack of ['dev', 'frozen']) {
        const review = await call('reviewStackStop', { stack, keepInfrastructure: true });
        assert.deepEqual(review.targets.flatMap(target => target.applications), ['applications/' + stack + '/runtime']);
        const stopped = await call('stopStack', { stack, keepInfrastructure: true, review: review.digest });
        assert.equal(stopped.status, 'stopped');
        assert.equal(stopped.stopOperation.phase, 'stopped');
      }
      for (const row of active) await until(() => !PidManager.isProcessAlive(row.pid), 'Reviewed bootstrap worker did not stop');
      previous = active.map(row => row.pid); active = [];
    },
    async finish() {
      assert.equal(report.phases.length, 2);
      assert.equal(report.declarationDriftRefused, true);
      assert.equal(report.watchPreservedFrozenWorkers, true);
      await verifyRuntimeArtifact(runtime, candidate.id, unchangedSince);
      return { ...report, sealedOwnerUnchanged: true, publicStackLifecycle: true };
    },
  };
}
