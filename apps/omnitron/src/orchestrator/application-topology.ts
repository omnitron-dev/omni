import fs from 'node:fs/promises';
import path from 'node:path';
import { Netron } from '@omnitron-dev/titan/netron';
import { UnixSocketTransport } from '@omnitron-dev/titan/netron/transport/unix';
import { AuthenticationManager, AuthorizationManager } from '@omnitron-dev/titan/netron/auth';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import { ServiceRouter } from './service-router.js';

/** One application launch owns one native Netron service namespace and listener. */
export class ApplicationTopology {
  readonly router: ServiceRouter;
  readonly url: string;
  private closing: Promise<void> | null = null;
  private closingRequested = false;
  private closed = false;

  private constructor(
    private readonly directory: string,
    private readonly netron: Netron,
    logger: ILogger,
  ) {
    this.router = new ServiceRouter(netron, logger);
    this.url = `unix://${path.join(directory, 'rpc.sock')}`;
  }

  /** Allocate before starting so the application handle owns failed starts too. */
  static async allocate(parent: string, application: string, logger: ILogger): Promise<ApplicationTopology> {
    await fs.mkdir(parent, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 ||
        (process.getuid && stat.uid !== process.getuid())) {
      throw new Error('Application topology directory must be private and owned by this user');
    }
    const root = await fs.realpath(parent);
    if (root.includes('?') || Buffer.byteLength(path.join(root, 't-XXXXXX', 'rpc.sock')) > 100) {
      throw new Error('Application topology directory cannot contain ? and must fit a 100-byte Unix socket path');
    }
    const directory = await fs.mkdtemp(path.join(root, 't-'));
    try {
      const netron = new Netron(logger, { id: `topology-${path.basename(directory)}` });
      netron.registerTransport('unix', () => new UnixSocketTransport());
      netron.registerTransportServer('unix', { name: 'application-topology', options: {
        path: path.join(directory, 'rpc.sock'), force: false, mode: 0o600,
      } });
      netron.configureAuth(new AuthenticationManager(logger, {
        authenticate: async () => { throw new Error('Application topology requires its private Unix socket'); },
        validateToken: async () => { throw new Error('Application topology does not accept bearer tokens'); },
        tokenCache: { enabled: false },
      }), new AuthorizationManager(logger));
      netron.setTransportAuthContext('unix', {
        userId: application, roles: ['application-topology'], permissions: [],
      });
      return new ApplicationTopology(directory, netron, logger);
    } catch (error) {
      await fs.rmdir(directory);
      throw error;
    }
  }

  async start(): Promise<void> {
    if (this.closingRequested) throw new Error('Application topology is closing or closed');
    await this.netron.start();
  }

  /** Retain ownership after a failed close; a later stop retries the same resources. */
  close(): Promise<void> {
    this.closingRequested = true;
    if (this.closed) return Promise.resolve();
    this.closing ??= this.release().finally(() => { this.closing = null; });
    return this.closing;
  }

  private async release(): Promise<void> {
    const failures: unknown[] = [];
    try { await this.router.releaseAll(); } catch (error) { failures.push(error); }
    try { await this.netron.stop(); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'Application topology shutdown incomplete');
    // No recursive removal: an unexpected file is evidence, not disposable state.
    await fs.rmdir(this.directory);
    this.closed = true;
  }
}
