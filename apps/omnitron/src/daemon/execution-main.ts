import fs from 'node:fs/promises';
import path from 'node:path';
import { LoggerService } from '@omnitron-dev/titan/module/logger';
import { startExecutionOwner } from './execution-owner.js';
import { PidManager } from './pid-manager.js';
import type { IEcosystemConfig, IDaemonConfig } from '../config/types.js';

const bootFile = process.argv[2];
if (!bootFile || !path.isAbsolute(bootFile)) throw new Error('An absolute execution boot record is required');
const stat = await fs.lstat(bootFile);
if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 ||
    (process.getuid && stat.uid !== process.getuid())) throw new Error('Execution boot record must be private');
const boot = JSON.parse(await fs.readFile(bootFile, 'utf8')) as {
  directory: string; cwd: string; config: IEcosystemConfig; daemonConfig: IDaemonConfig;
};
process.chdir(boot.cwd);
const logger = new LoggerService({ level: 'info' }).child({ component: 'execution-owner' });
let owner: Awaited<ReturnType<typeof startExecutionOwner>> | null = null;
let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  try { await owner?.stop(); process.exitCode = 0; }
  catch (error) { logger.error({ error }, 'Execution owner shutdown failed'); process.exitCode = 1; }
  finally { process.exit(process.exitCode); }
}
try {
  owner = await startExecutionOwner({ ...boot, logger, onShutdownRequested: () => { setTimeout(() => { void stop(); }, 100); } });
} catch (error) {
  new PidManager(path.join(boot.directory, 'owner.pid')).removeOwned();
  logger.error({ error }, 'Execution owner initialization failed; no applications were adopted');
  process.exit(1);
}
process.on('SIGTERM', () => { void stop(); });
process.on('SIGINT', () => { void stop(); });
process.send?.({ type: 'execution-ready', owner: owner.service.fence.owner });
// Losing a backend never ends the execution host. Its own signal handling
// and worker parent-death watchdogs retain their ordinary semantics.
process.disconnect?.();
