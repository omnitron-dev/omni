import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Netron } from '@omnitron-dev/titan/netron';
import { UnixSocketTransport } from '@omnitron-dev/titan/netron/transport/unix';
import { AuthenticationManager, AuthorizationManager } from '@omnitron-dev/titan/netron/auth';
import { Service, Public } from '@omnitron-dev/titan/decorators';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import { ADMIN_ROLES } from '../shared/roles.js';
import type { OmnitronDaemon } from './daemon.js';
import type { BackendBootRecord } from './backend-handoff-types.js';
import { executionDirectory } from './execution-launcher.js';
import { ExecutionJournal, writePrivateRecord } from './execution-journal.js';
import { PidManager } from './pid-manager.js';
import { OWN_BUILD } from '../shared/build-stamp.js';
import { OMNITRON_HOME } from '../config/defaults.js';

/** Kept separate from public ingress: it must answer while that ingress is drained. */
@Service({ name: 'OmnitronBackendControl' })
export class BackendControlService {
  private prepared: BackendBootRecord | null = null;
  private preparing = false;
  private retired = false;
  private retirement: Promise<void> | null = null;

  constructor(private readonly daemon: OmnitronDaemon, private readonly finish: () => void) {}

  @Public({ auth: { roles: ADMIN_ROLES } })
  async status() {
    return { runtime: this.daemon.backendRuntimeStatus(), retired: this.retired,
      instanceHome: OMNITRON_HOME,
      ticketId: this.prepared?.state.ticket.id ?? null, build: OWN_BUILD,
      entry: fileURLToPath(new URL('./daemon-entry.js', import.meta.url)) };
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async prepare(data: { candidateId: string }): Promise<{ file: string; ticketId: string }> {
    if (!/^[0-9a-f-]{36}$/i.test(data.candidateId)) throw new Error('A candidate UUID is required');
    if (this.preparing || this.prepared || this.retired) throw new Error('A backend transfer already exists');
    this.preparing = true;
    try {
      const state = await this.daemon.prepareBackendHandoff(data.candidateId);
      this.prepared = { protocol: 1, state, daemonConfig: this.daemon.daemonConfig,
        previousEntry: fileURLToPath(new URL('./daemon-entry.js', import.meta.url)), previousPid: process.pid,
        createdAt: new Date().toISOString(), cwd: process.cwd(),
        environment: Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
      };
      const file = path.join(executionDirectory(this.daemon.daemonConfig), `handoff-${state.ticket.id}.json`);
      try { await writePrivateRecord(file, this.prepared); }
      catch (error) { await this.daemon.abortBackendHandoff(state); this.prepared = null; throw error; }
      return { file, ticketId: state.ticket.id };
    } finally { this.preparing = false; }
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async abort(data: { ticketId: string }): Promise<void> {
    this.match(data.ticketId);
    if (this.retirement) throw new Error('Retirement has begun; restore a fresh backend from the checkpoint');
    await this.daemon.abortBackendHandoff(this.prepared!.state);
    this.prepared = null;
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async retire(data: { ticketId: string }): Promise<void> {
    this.match(data.ticketId);
    this.retirement ??= this.daemon.retireBackend().then(() => { this.retired = true; });
    await this.retirement;
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async complete(data: { ticketId: string }): Promise<void> {
    this.match(data.ticketId);
    if (!this.retired) throw new Error('Backend has not retired');
    const record = this.prepared!;
    const durable = await new ExecutionJournal(path.join(executionDirectory(record.daemonConfig), 'controller.json')).read();
    const successor = new PidManager(record.daemonConfig.pidFile).getPid();
    if (!successor || successor === process.pid || durable?.owner.id !== record.state.ticket.ownerId ||
        durable.grant.epoch <= record.state.ticket.from.epoch) {
      throw new Error('A live successor and a newer durable controller grant are required before retirement can complete');
    }
    // The command waits for the replacement's own readiness before asking
    // the old controller to exit. Only this isolated owner-user channel can
    // call it; the public web/API listeners never expose this service.
    setTimeout(this.finish, 100);
  }

  private match(ticketId: string): void {
    if (!this.prepared || this.prepared.state.ticket.id !== ticketId) throw new Error('Unknown backend transfer');
  }
}

export async function startBackendControl(daemon: OmnitronDaemon, controllerId: string, logger: ILogger): Promise<{ socket: string; stop(): Promise<void> }> {
  const socket = path.join(executionDirectory(daemon.daemonConfig), `c-${controllerId}.sock`);
  if (Buffer.byteLength(socket) > 100) throw new Error('Execution directory is too long for a private control socket; configure a shorter executionHost.directory');
  const netron = new Netron(logger, { id: `backend-control-${controllerId}` });
  netron.registerTransport('unix', () => new UnixSocketTransport());
  netron.registerTransportServer('unix', { name: 'backend-control', options: { path: socket, mode: 0o600, force: false, requestTimeout: 120_000 } });
  netron.configureAuth(new AuthenticationManager(logger, {
    authenticate: async () => { throw new Error('Backend replacement requires the private Unix socket'); },
    validateToken: async () => { throw new Error('Backend replacement does not accept bearer tokens'); },
    tokenCache: { enabled: false },
  }), new AuthorizationManager(logger));
  netron.setTransportAuthContext('unix', { userId: 'backend-local', roles: [...ADMIN_ROLES], permissions: [] });
  const service = new BackendControlService(daemon, () => { void netron.stop().finally(() => process.exit(0)); });
  await netron.peer.exposeService(service);
  await netron.start();
  return { socket, stop: () => netron.stop() };
}
