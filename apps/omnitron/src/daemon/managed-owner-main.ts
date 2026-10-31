import path from 'node:path';
import { LoggerService } from '@omnitron-dev/titan/module/logger';
import { readManagedRuntime, managedJobPid, hostBootIdentity, assertCleanOwnerBoot } from './managed-runtime.js';
import { readPrivateRecord, writePrivateRecord } from './execution-journal.js';
import { loadStartupConfig } from './startup-config.js';
import { startExecutionOwner } from './execution-owner.js';

const config = await readManagedRuntime();
if (!config || await managedJobPid(config, 'owner') !== process.pid) throw new Error('The resident owner must be launched by its configured OS service');
Object.assign(process.env, config.environment);
process.chdir(config.cwd);
const bootId = await hostBootIdentity();
const receipt = path.join(config.directory, 'managed-owner.json');
const previous = await readPrivateRecord<{ bootId: string; clean: boolean; pid: number }>(receipt);
assertCleanOwnerBoot(previous, bootId);
const startup = await loadStartupConfig(config.cwd);
if (!startup.daemonConfig.executionHost?.enabled) throw new Error('Independent supervision requires executionHost.enabled');
await writePrivateRecord(receipt, { bootId, clean: false, pid: process.pid });
const logger = new LoggerService({ level: 'info' }).child({ component: 'execution-owner' });
let stopping = false;
const owner = await startExecutionOwner({ directory: config.directory, ...startup, logger,
  onShutdownRequested: () => { setTimeout(() => { void stop(); }, 100); },
});
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  try {
    await owner.stop();
    await writePrivateRecord(receipt, { bootId, clean: true, pid: process.pid });
    process.exit(0);
  } catch (error) { logger.error({ error }, 'Owner shutdown is incomplete; automatic cold restart is refused'); process.exit(1); }
}
process.on('SIGTERM', () => { void stop(); });
process.on('SIGINT', () => { void stop(); });
