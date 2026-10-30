import { RecoveryMutation } from '../daemon/recovery-state.js';
import { randomUUID, createHash } from 'node:crypto';
import { Service, Public } from '@omnitron-dev/titan/decorators';
import { Errors } from '@omnitron-dev/titan/errors';
import type { AuthContext } from '@omnitron-dev/titan/netron/auth';
import { ADMIN_ROLES } from '../shared/roles.js';
import type { IOmnitronTerminalService } from '../shared/dto/services.js';
import type { TerminalPolicy, TerminalRead, TerminalSession } from '../shared/dto/terminal.js';
import { getCurrentAuth, runWithAuth } from './auth-context.js';
import type { NodeManagerService } from './node-manager.service.js';
import type { AuthService } from './auth.service.js';
import type { AuditService } from './audit.service.js';
import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import { XecTerminalDriver, type TerminalDriver, type TerminalPty } from './terminal-ssh.js';

export const TERMINAL_LIMITS = {
  outputBytes: 256 * 1024,
  readBytes: 64 * 1024,
  inputBytes: 8192,
  readWaitMs: 5000,
} as const;
export const DEFAULT_TERMINAL_POLICY: TerminalPolicy = {
  enabled: true,
  maxSessions: 32,
  maxSessionsPerOwner: 8,
  idleTimeoutMs: 15 * 60_000,
  absoluteTimeoutMs: 8 * 60 * 60_000,
  disconnectTimeoutMs: 90_000,
};

interface Owner {
  key: string;
  auth: AuthContext;
  sessionId?: string;
}
interface Session {
  view: TerminalSession;
  owner: Owner;
  pty?: TerminalPty;
  abort: AbortController;
  created: number;
  inputAt: number;
  readAt: number;
  closedAt?: number;
  output: Buffer;
  end: number;
  nextInput: number;
  lastDigest?: string;
  writing: boolean;
  reading: boolean;
  wake?: () => void;
  targetIdentity: string;
}
interface HostPin {
  fingerprint: string;
  target: string;
}

/** Limits are server policy, never values supplied by a browser. */
export function terminalPolicy(input: Partial<TerminalPolicy> = {}): TerminalPolicy {
  const policy = { ...DEFAULT_TERMINAL_POLICY, ...input };
  if (typeof policy.enabled !== 'boolean') throw new Error('terminal.enabled must be boolean');
  for (const key of [
    'maxSessions',
    'maxSessionsPerOwner',
    'idleTimeoutMs',
    'absoluteTimeoutMs',
    'disconnectTimeoutMs',
  ] as const) {
    if (!Number.isSafeInteger(policy[key]) || policy[key] < 1)
      throw new Error(`terminal.${key} must be a positive integer`);
  }
  if (policy.maxSessions > 128 || policy.maxSessionsPerOwner > 32)
    throw new Error('Terminal session caps exceed the supported maximum');
  return policy;
}

function dimension(value: unknown, name: string): number {
  if (!Number.isInteger(value) || (value as number) < 2 || (value as number) > 500)
    throw Errors.badRequest(`${name} must be an integer from 2 to 500`);
  return value as number;
}
function textId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 200)
    throw Errors.badRequest('A valid identifier is required');
  return value;
}

/** One owner per shell. No public attach token, raw command logs, or persisted transcript. */
@Service({ name: 'OmnitronTerminal' })
export class TerminalRpcService implements IOmnitronTerminalService {
  activeSessionCount(): number { return [...this.sessions.values()].filter(session => session.closedAt === undefined).length; }
  private readonly sessions = new Map<string, Session>();
  private readonly probing = new Set<string>();
  private readonly policy: TerminalPolicy;
  private readonly timer: ReturnType<typeof setInterval>;
  private sweeping = false;
  private stopped = false;

  constructor(
    private readonly nodes: Pick<NodeManagerService, 'getNode' | 'nodeToSshTarget'>,
    private readonly auth: Pick<AuthService, 'validateSession'>,
    private readonly store: Pick<DaemonStateStore, 'kvGetSync' | 'kvSetSync'>,
    private readonly audit: Pick<AuditService, 'record'>,
    options: Partial<TerminalPolicy> = {},
    private readonly driver: TerminalDriver = new XecTerminalDriver(),
    private readonly now: () => number = Date.now
  ) {
    this.policy = terminalPolicy(options);
    this.timer = setInterval(() => {
      void this.sweep().catch(() => {
        for (const session of this.sessions.values()) this.finish(session, 'control_plane_unavailable');
      });
    }, 2000);
    this.timer.unref();
  }

  private async owner(): Promise<Owner> {
    if (this.stopped || !this.policy.enabled) throw Errors.forbidden('SSH terminals are disabled on this daemon');
    const auth = getCurrentAuth();
    if (!auth?.roles?.includes('admin') || !auth.userId)
      throw Errors.forbidden('SSH terminal requires an administrator');
    // This marker is assigned by the owner-only Unix transport, never from a JWT.
    if (auth.userId === 'omnitron-local' && auth.metadata?.['source'] === 'local-unix-socket')
      return { key: 'local-unix', auth };
    const sessionId = auth.metadata?.['sessionId'];
    if (typeof sessionId !== 'string') throw Errors.forbidden('SSH terminal requires an active human session');
    const owner = { key: `${auth.userId}:${sessionId}`, sessionId, auth };
    if (!(await this.valid(owner)))
      throw Errors.forbidden('SSH terminal session has expired, been revoked, or lost administrator access');
    return owner;
  }

  private async valid(owner: Owner): Promise<boolean> {
    if (!owner.sessionId) return true;
    // Bypass the transport token cache: revocation and demotion take effect on every operation.
    const current = await this.auth.validateSession(owner.sessionId);
    return current?.id === owner.auth.userId && current.role === 'admin';
  }

  private node(id: unknown) {
    const node = this.nodes.getNode(textId(id));
    if (!node || node.isLocal) throw Errors.badRequest('Select a registered remote SSH node');
    return node;
  }

  private identity(node: { host: string; sshPort: number; sshUser: string }): string {
    return JSON.stringify([node.host, node.sshPort, node.sshUser]);
  }

  private pin(node: ReturnType<TerminalRpcService['node']>): string | null {
    const pin = this.store.kvGetSync<HostPin>(`terminal:host-key:${node.id}`);
    return pin?.target === this.identity(node) ? pin.fingerprint : null;
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async capabilities(): Promise<TerminalPolicy> {
    await this.owner();
    return { ...this.policy };
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async inspectHost(data: { nodeId: string }) {
    const owner = await this.owner();
    const node = this.node(data?.nodeId);
    if (this.probing.has(owner.key) || this.probing.size >= 8)
      throw Errors.badRequest('An SSH host key probe is already in progress; try again shortly');
    this.probing.add(owner.key);
    try {
      const observed = await this.driver.probe({ host: node.host, port: node.sshPort });
      return { nodeId: node.id, host: node.host, port: node.sshPort, observed, trusted: this.pin(node) };
    } finally {
      this.probing.delete(owner.key);
    }
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async trustHost(data: { nodeId: string; fingerprint: string; previous: string | null }): Promise<void> {
    await this.owner();
    const node = this.node(data?.nodeId);
    if (typeof data.fingerprint !== 'string' || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(data.fingerprint))
      throw Errors.badRequest('Provide the independently verified SHA256 host fingerprint');
    const targetIdentity = this.identity(node);
    const previous = this.pin(node);
    if (data.previous !== previous) throw Errors.badRequest('The trusted host key changed; inspect the node again');
    await this.audit.record(
      {
        action: 'terminal.host-key.trust.requested',
        resourceType: 'node',
        resourceId: node.id,
        details: { fingerprint: data.fingerprint, previous, host: node.host, username: node.sshUser },
      },
      true
    );
    // Audit is async: recheck the registry and pin before committing a trust change.
    await this.owner();
    if (this.identity(this.node(node.id)) !== targetIdentity || this.pin(node) !== previous)
      throw Errors.badRequest('Node or host key changed; inspect it again');
    this.store.kvSetSync(`terminal:host-key:${node.id}`, {
      fingerprint: data.fingerprint,
      target: this.identity(node),
    });
    for (const session of this.sessions.values())
      if (session.view.nodeId === node.id) this.finish(session, 'host_key_changed');
    await this.audit.record({
      action: 'terminal.host-key.trust',
      resourceType: 'node',
      resourceId: node.id,
      details: { fingerprint: data.fingerprint, previous, host: node.host, username: node.sshUser },
    });
  }

  @RecoveryMutation()
  @Public({ auth: { roles: ADMIN_ROLES } })
  async open(data: { nodeId: string; cols: number; rows: number }): Promise<TerminalSession> {
    const owner = await this.owner();
    const node = this.node(data?.nodeId);
    const cols = dimension(data.cols, 'cols'),
      rows = dimension(data.rows, 'rows');
    const fingerprint = this.pin(node);
    if (!fingerprint) throw Errors.forbidden('Verify and trust this node’s SSH host key before opening a terminal');
    const active = [...this.sessions.values()].filter((s) => s.view.state !== 'closed');
    if (
      active.length >= this.policy.maxSessions ||
      active.filter((s) => s.owner.key === owner.key).length >= this.policy.maxSessionsPerOwner
    )
      throw Errors.badRequest('Terminal session limit reached; close an existing session first');
    // Closed transcripts are short-lived, but rapid open/close loops must also be bounded.
    if (this.sessions.size >= this.policy.maxSessions * 2) {
      for (const [id, session] of this.sessions) {
        if (session.view.state === 'closed') this.sessions.delete(id);
        if (this.sessions.size < this.policy.maxSessions * 2) break;
      }
    }
    const at = this.now();
    const session: Session = {
      owner,
      created: at,
      inputAt: at,
      readAt: at,
      output: Buffer.alloc(0),
      end: 0,
      nextInput: 0,
      writing: false,
      reading: false,
      abort: new AbortController(),
      targetIdentity: this.identity(node),
      view: {
        id: randomUUID(),
        nodeId: node.id,
        nodeName: node.name,
        host: node.host,
        username: node.sshUser,
        fingerprint,
        cols,
        rows,
        createdAt: new Date(at).toISOString(),
        state: 'connecting',
      },
    };
    // Reserve before the first await, so concurrent opens cannot bypass caps.
    this.sessions.set(session.view.id, session);
    try {
      await this.audit.record(
        {
          action: 'terminal.open.requested',
          resourceType: 'terminal',
          resourceId: session.view.id,
          details: { nodeId: node.id, host: node.host, username: node.sshUser, fingerprint },
        },
        true
      );
      const target = await this.nodes.nodeToSshTarget(node);
      if (
        !(await this.valid(owner)) ||
        this.identity(this.node(node.id)) !== session.targetIdentity ||
        this.pin(this.node(node.id)) !== fingerprint
      )
        throw new Error('Terminal access or host key changed');
      session.pty = await this.driver.connect(
        target,
        fingerprint,
        cols,
        rows,
        (bytes) => this.append(session, bytes),
        (reason, code) => this.finish(session, reason, code),
        session.abort.signal
      );
      if (session.view.state === 'closed') {
        session.pty.close();
        throw new Error(session.view.reason);
      }
      session.view.state = 'open';
      await this.audit.record({
        action: 'terminal.open',
        resourceType: 'terminal',
        resourceId: session.view.id,
        details: { nodeId: node.id },
      });
      return { ...session.view };
    } catch (err) {
      this.finish(session, 'open_failed');
      throw err;
    }
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async list(): Promise<TerminalSession[]> {
    const owner = await this.owner();
    return [...this.sessions.values()].filter((s) => s.owner.key === owner.key).map((s) => ({ ...s.view }));
  }

  private async owned(id: unknown): Promise<Session> {
    const owner = await this.owner();
    const session = this.sessions.get(textId(id));
    if (!session || session.owner.key !== owner.key) throw Errors.forbidden('Terminal is unavailable to this session');
    if (session.view.state !== 'closed') {
      const node = this.nodes.getNode(session.view.nodeId);
      if (!node || this.identity(node) !== session.targetIdentity || this.pin(node) !== session.view.fingerprint)
        this.finish(session, 'node_changed');
    }
    return session;
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async read(data: { id: string; cursor: number; wait?: boolean }): Promise<TerminalRead> {
    const session = await this.owned(data?.id);
    if (!Number.isSafeInteger(data.cursor) || data.cursor < 0 || data.cursor > session.end)
      throw Errors.badRequest('Invalid terminal output cursor');
    if (session.reading) throw Errors.badRequest('A terminal output read is already pending');
    session.reading = true;
    session.readAt = this.now();
    try {
      if (data.wait !== false && data.cursor === session.end && session.view.state !== 'closed') {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(done, TERMINAL_LIMITS.readWaitMs);
          function done() {
            clearTimeout(timer);
            delete session.wake;
            resolve();
          }
          session.wake = done;
        });
      }
      // A session could be revoked while a long poll was waiting.
      if (!(await this.valid(session.owner))) {
        this.finish(session, 'access_revoked');
        throw Errors.forbidden('Terminal access was revoked');
      }
      const start = Math.max(data.cursor, session.end - session.output.length);
      const cursor = Math.min(session.end, start + TERMINAL_LIMITS.readBytes);
      return {
        cursor,
        data: session.output
          .subarray(start - (session.end - session.output.length), cursor - (session.end - session.output.length))
          .toString('base64'),
        droppedBytes: start - data.cursor,
        hasMore: cursor < session.end,
        session: { ...session.view },
      };
    } finally {
      session.reading = false;
    }
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async write(data: { id: string; sequence: number; data: string }): Promise<{ nextSequence: number }> {
    const session = await this.owned(data?.id);
    if (
      typeof data.data !== 'string' ||
      data.data.length > Math.ceil(TERMINAL_LIMITS.inputBytes / 3) * 4 ||
      !data.data.length
    )
      throw Errors.badRequest('Terminal input must contain 1 to 8192 bytes encoded as base64');
    const bytes = Buffer.from(data.data, 'base64');
    if (!bytes.length || bytes.length > TERMINAL_LIMITS.inputBytes || bytes.toString('base64') !== data.data)
      throw Errors.badRequest('Terminal input must contain 1 to 8192 bytes encoded as canonical base64');
    if (!Number.isSafeInteger(data.sequence) || data.sequence < 0)
      throw Errors.badRequest('Invalid terminal input sequence');
    const digest = createHash('sha256').update(bytes).digest('hex');
    // Retrying an acknowledged write does not execute pasted commands twice.
    if (data.sequence === session.nextInput - 1 && digest === session.lastDigest)
      return { nextSequence: session.nextInput };
    if (session.view.state !== 'open' || !session.pty) throw Errors.badRequest('Terminal is not open');
    if (session.writing || data.sequence !== session.nextInput)
      throw Errors.badRequest('Terminal input is out of order; reconnect before sending more input');
    session.writing = true;
    session.inputAt = this.now();
    try {
      await session.pty.write(bytes);
      session.lastDigest = digest;
      session.nextInput++;
      return { nextSequence: session.nextInput };
    } catch {
      this.finish(session, 'input_failed');
      throw new Error('Terminal input failed; session closed to prevent ambiguous replay');
    } finally {
      session.writing = false;
    }
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async resize(data: { id: string; cols: number; rows: number }): Promise<void> {
    const session = await this.owned(data?.id);
    const cols = dimension(data.cols, 'cols'),
      rows = dimension(data.rows, 'rows');
    if (session.view.state !== 'open') return;
    session.pty?.resize(cols, rows);
    session.view.cols = cols;
    session.view.rows = rows;
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async close(data: { id: string }): Promise<void> {
    const owner = await this.owner();
    const session = this.sessions.get(textId(data?.id));
    // Closing an already-pruned session is a no-op, but still requires live authority.
    if (!session) return;
    if (session.owner.key !== owner.key) throw Errors.forbidden('Terminal is unavailable to this session');
    this.finish(session, 'closed_by_operator');
  }

  private append(session: Session, data: Buffer): void {
    if (session.view.state === 'closed') return;
    session.end += data.length;
    session.output = Buffer.concat([session.output, data]).subarray(-TERMINAL_LIMITS.outputBytes);
    // Copy the bounded view: a tiny subarray must not retain an arbitrarily large parent.
    session.output = Buffer.from(session.output);
    session.wake?.();
  }

  private finish(session: Session, reason: string, exitCode?: number): void {
    if (session.view.state === 'closed') return;
    session.view.state = 'closed';
    session.view.reason = reason;
    if (exitCode !== undefined) session.view.exitCode = exitCode;
    session.closedAt = this.now();
    session.abort.abort();
    session.pty?.close();
    session.wake?.();
    void Promise.resolve(
      runWithAuth(session.owner.auth, () =>
        this.audit.record({
          action: 'terminal.close',
          resourceType: 'terminal',
          resourceId: session.view.id,
          details: {
            nodeId: session.view.nodeId,
            reason,
            durationMs: this.now() - session.created,
            outputBytes: session.end,
          },
        })
      )
    ).catch(() => undefined);
  }

  async sweep(): Promise<void> {
    if (this.sweeping || this.stopped) return;
    this.sweeping = true;
    try {
      for (const [id, session] of this.sessions) {
        const now = this.now();
        if (session.view.state === 'closed') {
          if (now - (session.closedAt ?? now) > 60_000) this.sessions.delete(id);
          continue;
        }
        let reason: string | null = null;
        if (now - session.created > this.policy.absoluteTimeoutMs) reason = 'maximum_lifetime';
        else if (now - session.inputAt > this.policy.idleTimeoutMs) reason = 'idle_timeout';
        else if (now - session.readAt > this.policy.disconnectTimeoutMs) reason = 'client_disconnected';
        else {
          try {
            if (!(await this.valid(session.owner))) reason = 'access_revoked';
          } catch {
            reason = 'session_store_unavailable';
          }
          const node = this.nodes.getNode(session.view.nodeId);
          if (!node || this.identity(node) !== session.targetIdentity || this.pin(node) !== session.view.fingerprint)
            reason = 'node_changed';
        }
        if (reason) this.finish(session, reason);
      }
    } finally {
      this.sweeping = false;
    }
  }

  dispose(): void {
    this.stopped = true;
    clearInterval(this.timer);
    for (const session of this.sessions.values()) this.finish(session, 'daemon_stopped');
    this.sessions.clear();
  }
}
