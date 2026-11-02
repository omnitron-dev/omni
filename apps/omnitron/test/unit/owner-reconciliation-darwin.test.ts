import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { hostBootIdentity, type ManagedRuntime } from '../../src/daemon/managed-runtime.js';
import { readPrivateRecord, writePrivateRecord } from '../../src/daemon/execution-journal.js';
import { readProcessLifetime } from '../../src/monitoring/process-lifetime.js';
import { prepareOwnerReconciliation, acknowledgeOwnerReconciliation, consumeOwnerReconciliation } from '../../src/daemon/owner-reconciliation.js';

// All processes, records and sockets in this test are newly created fixtures.
// The launchd labels deliberately do not exist; no OS job is loaded or stopped.
it.skipIf(process.platform !== 'darwin')('requires a complete native drain, unchanged sealed plan and an unused acknowledgment on macOS', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'or-')));
  await fs.chmod(root, 0o700);
  const id = randomUUID(), bootId = await hostBootIdentity();
  const config: ManagedRuntime = { protocol: 1, instanceHome: root, directory: root, cwd: root, scope: 'user', environment: { OMNITRON_HOME: root },
    owner: { label: `dev.omnitron.fixture-${id}.owner`, unit: 'omnitron-fixture-owner.service', artifact: 'a'.repeat(64) },
    backend: { label: `dev.omnitron.fixture-${id}.backend`, unit: 'omnitron-fixture-backend.service', artifact: 'b'.repeat(64) } };
  const old = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' }); const oldPid = old.pid!; await once(old, 'close');
  const receipt = { bootId, clean: false, pid: oldPid };
  await writePrivateRecord(path.join(root, 'managed-owner.json'), receipt);
  await writePrivateRecord(path.join(root, 'controller.json'), { protocol: 1,
    owner: { id, pid: oldPid, startedAt: new Date().toISOString() }, grant: { ownerId: id, controllerId: 'fixture', epoch: 1 } });
  const worker = spawn(process.execPath, ['--input-type=module', '-e',
    "import{spawn}from'node:child_process'; const c=spawn('/bin/sleep',['60']); console.log(c.pid);setInterval(()=>{},1000);"], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(worker, 'close'); let childPid = 0; const socket = net.createServer();
  const stopChild = async () => {
    if (!childPid) return;
    try { process.kill(childPid, 'SIGTERM'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    for (let n = 0; n < 100 && readProcessLifetime(childPid).state !== 'dead'; n++) await new Promise(resolve => setTimeout(resolve, 20));
    expect(readProcessLifetime(childPid).state).toBe('dead'); childPid = 0;
  };
  try {
    childPid = Number(String((await once(worker.stdout!, 'data'))[0]).trim()); expect(childPid).toBeGreaterThan(0);
    const plan = await prepareOwnerReconciliation(config, [worker.pid!]);
    expect(plan.processes.map(p => p.pid)).toEqual(expect.arrayContaining([oldPid, worker.pid, childPid]));
    expect(plan.native?.processGroups).toContain(worker.pid);
    expect(plan.processes.find(p => p.pid === worker.pid)?.lifetime).toBe((readProcessLifetime(worker.pid!) as { identity: string }).identity);
    await expect(acknowledgeOwnerReconciliation(config, plan)).rejects.toThrow('process group');
    await expect(acknowledgeOwnerReconciliation(config, { ...plan, processes: plan.processes.filter(p => p.pid !== childPid) })).rejects.toThrow('unsealed or changed');
    await stopChild(); worker.kill('SIGTERM'); await closed;
    await new Promise<void>((resolve, reject) => { socket.once('error', reject); socket.listen(path.join(root, 'backend.sock'), resolve); });
    await expect(acknowledgeOwnerReconciliation(config, plan)).rejects.toThrow('socket');
    await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
    const archive = await acknowledgeOwnerReconciliation(config, plan);
    expect(await readPrivateRecord(path.join(root, 'managed-owner.json'))).toEqual(receipt);
    expect((await readPrivateRecord<{ plan: unknown }>(archive))?.plan).toEqual(plan);
    await expect(consumeOwnerReconciliation(config, receipt, bootId)).rejects.toThrow('services must be stopped');
    // Simulate a failed publication after the durable consume archive was saved.
    const ack = (await readPrivateRecord<{ attemptId: string }>(path.join(root, 'owner-reconciliation.json')))!;
    await writePrivateRecord(path.join(root, 'owner-reconciliations', `${plan.id}.${ack.attemptId}.consumed.json`), { consumedBy: 'fixture' });
    await expect(acknowledgeOwnerReconciliation(config, plan)).rejects.toThrow('already been consumed');
    await expect(consumeOwnerReconciliation(config, receipt, bootId)).rejects.toThrow('already been consumed');
    // A different active acknowledgment cannot make an already consumed plan reusable.
    await writePrivateRecord(path.join(root, 'owner-reconciliations', `${plan.id}.consumed.json`), { consumedBy: 'fixture' });
    await fs.unlink(path.join(root, 'owner-reconciliation.json'));
    await expect(acknowledgeOwnerReconciliation(config, plan)).rejects.toThrow('plan has already been consumed');
  } finally {
    if (socket.listening) await new Promise<void>(resolve => socket.close(() => resolve()));
    await stopChild();
    if (worker.exitCode === null && worker.signalCode === null) { worker.kill('SIGKILL'); await closed; }
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30000);
