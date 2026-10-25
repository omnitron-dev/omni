import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
const scenarios = JSON.parse(fs.readFileSync(0, 'utf8'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const run = script => execFileSync('sh', ['-c', script], { encoding: 'utf8' });
const start = script => {
  const child = spawn('sh', ['-c', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', c => output += c); child.stderr.on('data', c => output += c);
  const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal, output })); });
  return { child, done };
};
const until = async predicate => { for (let n = 0; n < 250; n++) { if (predicate()) return; await delay(20); } throw Error('native fixture timed out'); };
const age = s => fs.utimesSync(`${s.dir}/deploy.lease`, 0, 0);
const begin = s => { fs.mkdirSync(s.dir, { recursive: true }); assert.match(run(s.acquireA), /ACQUIRED/); };
const children = pid => { try { return fs.readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean).map(Number); } catch { return []; } };
const find = (pid, name) => { for (const child of children(pid)) { try { if (fs.readFileSync(`/proc/${child}/comm`, 'utf8').trim() === name) return child; } catch {} const nested = find(child, name); if (nested) return nested; } return undefined; };
// The exact pre-fix protocol admits B while A's already-dispatched command survives.
{
  const s = scenarios.raw; begin(s); const a = start(`touch '${s.dir}/started'; sleep 1; printf A > '${s.dir}/result'`);
  await until(() => fs.existsSync(`${s.dir}/started`)); age(s);
  assert.match(run(s.acquireB), /ACQUIRED/); fs.writeFileSync(`${s.dir}/result`, 'B'); await a.done;
  assert.equal(fs.readFileSync(`${s.dir}/result`, 'utf8'), 'A');
  console.log('baseline: stale in-flight writer overwrote new writer');
}
{
  const s = scenarios.race; begin(s); const a = start(s.long);
  await until(() => fs.existsSync(`${s.dir}/started`)); age(s);
  assert.equal(JSON.parse(fs.readFileSync(`${s.dir}/deploy.execution.json`, 'utf8')).schema, 1);
  assert.match(run(s.acquireB), /EXECUTION-BUSY/); assert.match(run(s.releaseA), /EXECUTION-BUSY/);
  assert.match(run(s.renewA), /RENEWED/); assert.equal((await a.done).code, 0);
  age(s); assert.match(run(s.acquireB), /ACQUIRED/);
  assert.equal((await start(s.stale).done).code, 73);
  assert.equal((await start(s.current).done).code, 0);
  assert.equal(fs.readFileSync(`${s.dir}/result`, 'utf8'), 'B');
  console.log('fenced: execution excludes replacement/release; renew works; stale token refused');
}
{
  const s = scenarios.failure; begin(s);
  assert.equal((await start(s.failure).done).code, 23);
  assert.equal(fs.existsSync(`${s.dir}/deploy.execution.json`), false);
  assert.equal((await start(s.timeout).done).code, 124);
  assert.equal(fs.existsSync(`${s.dir}/late`), false);
  assert.equal(fs.existsSync(`${s.dir}/deploy.execution.json`), true);
  assert.match(run(s.releaseA), /EXECUTION-UNRESOLVED/);
  console.log('ordinary child failure clears; timeout remains unresolved without descendant-death proof');
}
{
  const s = scenarios.killedLock; begin(s); const a = start(s.long);
  await until(() => fs.existsSync(`${s.dir}/started`));
  const holder = find(a.child.pid, 'flock'); assert.ok(holder, 'flock holder must exist');
  process.kill(holder, 'SIGKILL'); await a.done; age(s);
  assert.match(run(s.acquireB), /EXECUTION-UNRESOLVED/);
  await until(() => !fs.existsSync(`${s.dir}/deploy.execution.json`));
  age(s); assert.match(run(s.acquireB), /ACQUIRED/);
  console.log('SIGKILL of kernel lock holder cannot admit takeover while its worker continues');
}
{
  const s = scenarios.killedWorker; begin(s); const a = start(s.long);
  await until(() => fs.existsSync(`${s.dir}/started`));
  const holder = find(a.child.pid, 'flock'); assert.ok(holder);
  const worker = children(holder)[0]; assert.ok(worker); process.kill(worker, 'SIGKILL');
  await a.done; age(s); assert.match(run(s.acquireB), /EXECUTION-UNRESOLVED/);
  await delay(1300); age(s);
  assert.match(run(s.acquireB), /EXECUTION-UNRESOLVED/);
  assert.equal((await start(s.stale).done).code, 73);
  console.log('SIGKILL of worker retains unresolved intent even after its child exits');
}
{
  const s = scenarios.killedTimeout; begin(s); const a = start(s.long);
  await until(() => fs.existsSync(`${s.dir}/started`));
  const timer = find(a.child.pid, 'timeout'); assert.ok(timer); process.kill(timer, 'SIGKILL');
  assert.equal((await a.done).code, 137); age(s);
  assert.match(run(s.acquireB), /EXECUTION-UNRESOLVED/);
  await until(() => fs.existsSync(`${s.dir}/result`)); age(s);
  assert.match(run(s.acquireB), /EXECUTION-UNRESOLVED/);
  console.log('SIGKILL of timeout retains intent while orphaned command continues');
}
{
  const s = scenarios.background; begin(s); const began = Date.now();
  assert.equal((await start(s.background).done).code, 0);
  assert.match(run(s.releaseA), /RELEASED/); assert.match(run(s.acquireB), /ACQUIRED/);
  assert.ok(Date.now() - began < 2000, 'background sleeper must not inherit execution lock');
  console.log('managed/background process does not retain kernel execution lock');
}
