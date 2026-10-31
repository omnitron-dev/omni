import { Netron } from '@omnitron-dev/titan/netron';
import { UnixSocketTransport } from '@omnitron-dev/titan/netron/transport/unix';
import { AuthenticationManager, AuthorizationManager } from '@omnitron-dev/titan/netron/auth';
import { LoggerService } from '@omnitron-dev/titan/module/logger';
import { ADMIN_ROLES } from '../shared/roles.js';
import { readManagedRuntime, managedSupervisorSocket, managedJobPid } from './managed-runtime.js';
import { BackendSupervisorService } from './backend-supervisor.js';

const config = await readManagedRuntime();
if (!config) throw new Error('Independent supervision has not been configured');
if (await managedJobPid(config, 'backend') !== process.pid) throw new Error('Only the configured OS service may own the supervisor socket');
Object.assign(process.env, config.environment);
const logger = new LoggerService({ level: 'info' }).child({ component: 'backend-supervisor' });
const netron = new Netron(logger, { id: `supervisor-${process.pid}` });
netron.registerTransport('unix', () => new UnixSocketTransport());
netron.registerTransportServer('unix', { name: 'backend-supervisor', options: { path: managedSupervisorSocket(config), mode: 0o600, force: true, requestTimeout: 600_000 } });
netron.configureAuth(new AuthenticationManager(logger, {
  authenticate: async () => { throw new Error('Supervisor control requires the private local socket'); },
  validateToken: async () => { throw new Error('Supervisor control does not accept bearer tokens'); },
  tokenCache: { enabled: false },
}), new AuthorizationManager(logger));
netron.setTransportAuthContext('unix', { userId: 'supervisor-local', roles: [...ADMIN_ROLES], permissions: [] });
const service = new BackendSupervisorService(config, code => { void netron.stop().finally(() => process.exit(code)); });
await netron.peer.exposeService(service);
await netron.start();
let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  try { await service.stop(); await netron.stop(); process.exit(0); }
  catch (error) { logger.error({ error }, 'Backend supervisor shutdown failed'); process.exit(1); }
}
process.on('SIGTERM', () => { void stop(); });
process.on('SIGINT', () => { void stop(); });
await service.start();
