import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import { jwtVerify } from 'jose';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Public, Service } from '@omnitron-dev/titan/decorators';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { Netron } from '@omnitron-dev/titan/netron';
import { AuthenticationManager, AuthorizationManager } from '@omnitron-dev/titan/netron/auth';
import { TcpTransport } from '@omnitron-dev/titan/netron/transport/tcp';
import { createMeshDialer, directLink, meshManagementIdentity, mintServiceToken } from '../../src/cluster/mesh-link.js';
import { SlaveConnector } from '../../src/cluster/slave-connector.js';
import { ExecutionService, type SSHTarget } from '../../src/execution/execution.service.js';
import { FlowLedger } from '../../src/flows/flow-ledger.js';
import { flowWorkspaceReader } from '../../src/flows/host-flow-runtime.js';
import { digest, encryptGraph, signature } from '../../src/flows/peer-review-crypto.js';
import { invitationLifetime } from '../../src/flows/peer-review-ledger.js';
import {
  FlowReviewRpcService,
  FlowReviewPeerRpcService,
  type FlowReviewRoute,
} from '../../src/flows/peer-review.rpc-service.js';
import { createAuthContextWrapper, runWithAuth } from '../../src/services/auth-context.js';
import { createDaemonTokenValidator } from '../../src/services/daemon-authority.js';
import { defaultFlowRegistry, diskSpaceFlow, type FlowDefinition } from '../../src/shared/dto/flows.js';
import type { FlowSubmissionReceipt, OmnitronAuthUser } from '../../src/shared/dto/services.js';

const run = promisify(execFile);
const logger = createNullLogger();
const workspace = { project: 'example' };
const definition: FlowDefinition = {
  version: 1,
  name: 'Review the result',
  nodes: [
    { id: 'start', type: 'input.manual@1', config: {} },
    { id: 'notice', type: 'output.notify@1', config: { title: 'Local review is ready' } },
  ],
  edges: [{ from: 'start', port: 'event', to: 'notice' }],
};
const actor = async <T>(userId: string, task: () => Promise<T>, role = 'admin'): Promise<T> =>
  runWithAuth(
    {
      userId,
      roles: [role],
      permissions: [],
      metadata: { sessionId: userId },
    },
    task
  );
function registration(path: string) {
  let registeredAt = '2026-01-01T00:00:00Z';
  const scope = flowWorkspaceReader({
    getWorkspaceDirectory(name: string) {
      if (name !== workspace.project) throw Error('Unknown project');
      return path;
    },
    projectConfigurations: () => [{ name: workspace.project, path, registeredAt }],
  } as never);
  return {
    scope,
    replace: () => {
      registeredAt = randomUUID();
    },
  };
}

@Service('OmnitronDaemon@1.0.0')
class Liveness {
  @Public({ auth: { allowAnonymous: true } })
  ping() {
    return { version: 'test' };
  }
}

async function privateSshServer(
  directory: string,
  netronPort: number,
  secret: string,
  started: (child: ChildProcess) => void
) {
  const hostKey = join(directory, 'host'),
    clientKey = join(directory, 'client');
  for (const key of [hostKey, clientKey]) await run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key]);
  const fingerprint = (await run('ssh-keygen', ['-lf', hostKey + '.pub', '-E', 'sha256'])).stdout
    .trim()
    .split(/\s+/)[1]!;
  const reserve = createServer();
  reserve.listen(0, '127.0.0.1');
  await once(reserve, 'listening');
  const port = (reserve.address() as { port: number }).port;
  await new Promise<void>((done) => reserve.close(() => done()));
  const sshd = process.env['OMNITRON_TEST_SSHD'] ?? '/usr/sbin/sshd';
  const secretFile = join(directory, 'fixture-token');
  await writeFile(secretFile, secret, { mode: 0o600 });
  const config = join(directory, 'sshd_config');
  await writeFile(
    config,
    [
      'ListenAddress 127.0.0.1',
      'Port ' + port,
      'HostKey ' + JSON.stringify(hostKey),
      'PidFile ' + JSON.stringify(join(directory, 'sshd.pid')),
      'AllowUsers ' + userInfo().username,
      'UsePAM no',
      'PasswordAuthentication no',
      'KbdInteractiveAuthentication no',
      'StrictModes no',
      'AuthorizedKeysFile ' + JSON.stringify(clientKey + '.pub'),
      'AllowTcpForwarding local',
      'PermitOpen 127.0.0.1:' + netronPort,
      'PermitTTY no',
      'AllowAgentForwarding no',
      'X11Forwarding no',
      'ForceCommand /bin/cat ' + JSON.stringify(secretFile),
    ].join('\n') + '\n',
    { mode: 0o600 }
  );
  const server = spawn(sshd, ['-D', '-e', '-f', config], { stdio: ['ignore', 'ignore', 'pipe'] });
  started(server);
  let diagnostics = '';
  server.stderr.on('data', (chunk) => {
    diagnostics += chunk;
  });
  await vi.waitFor(
    () => {
      if (server.exitCode !== null) throw Error('Isolated OpenSSH server exited: ' + diagnostics);
      expect(diagnostics).toContain('Server listening');
    },
    { timeout: 3000 }
  );
  return {
    host: '127.0.0.1',
    port,
    username: userInfo().username,
    privateKey: await readFile(clientKey, 'utf8'),
    expectedHostFingerprint: fingerprint,
  } satisfies SSHTarget;
}

describe('peer review across two independent controller ledgers', () => {
  let directory: string,
    senderDB: Database.Database,
    receiverDB: Database.Database,
    sender: FlowLedger,
    receiver: FlowLedger;
  let source: ReturnType<typeof registration>,
    destination: ReturnType<typeof registration>,
    senderRpc: FlowReviewRpcService,
    receiverRpc: FlowReviewRpcService;
  let nodeId: string, revision: string, flowId: string, now: number, route: FlowReviewRoute;
  let host: Netron | undefined,
    connector: SlaveConnector | undefined,
    execution: ExecutionService | undefined,
    sshd: ChildProcess | undefined;
  let receives = 0;
  const admit = async () => {},
    audit = { record: async () => {} };
  const auth = {
    validateSession: async (id: string) => ({ id, role: id === 'reader' ? 'viewer' : 'admin' }) as OmnitronAuthUser,
  };
  beforeEach(async () => {
    receives = 0;
    directory = await mkdtemp(join(tmpdir(), 'peer-flow-'));
    await Promise.all(['source', 'destination'].map((side) => mkdir(join(directory, side))));
    now = Date.now();
    nodeId = randomUUID();
    flowId = randomUUID();
    senderDB = new Database(join(directory, 'source.sqlite'));
    receiverDB = new Database(join(directory, 'destination.sqlite'));
    sender = new FlowLedger(senderDB, defaultFlowRegistry, () => now);
    receiver = new FlowLedger(receiverDB, defaultFlowRegistry, () => now);
    source = registration(join(directory, 'source'));
    destination = registration(join(directory, 'destination'));
    const noPeer = () => {
      throw Error('No management transport');
    };
    route = { pin: 'enrolled', open: noPeer };
    senderRpc = new FlowReviewRpcService(
      {
        get ledger() {
          return sender;
        },
        scope: source.scope,
        admit,
      },
      auth,
      audit,
      (id) => {
        if (id !== nodeId) throw Error('Wrong node');
        return route;
      }
    );
    receiverRpc = new FlowReviewRpcService(
      {
        get ledger() {
          return receiver;
        },
        scope: destination.scope,
        admit,
      },
      auth,
      audit,
      noPeer
    );
    revision = sender.save(
      { workspace, id: flowId, definition, expectedRevision: null },
      await source.scope(workspace)
    ).revision;
  });
  afterEach(async () => {
    try {
      await connector?.dispose();
      await host?.stop();
      await execution?.dispose();
      if (sshd?.pid && sshd.exitCode === null && sshd.signalCode === null) {
        const ended = once(sshd, 'exit');
        sshd.kill('SIGTERM');
        await ended;
      }
    } finally {
      connector = undefined;
      host = undefined;
      execution = undefined;
      sshd = undefined;
      if (senderDB?.open) senderDB.close();
      if (receiverDB?.open) receiverDB.close();
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  });
  async function listening() {
    const secret = randomBytes(32).toString('hex');
    host = new Netron(logger);
    host.configureAuth(
      new AuthenticationManager(logger, {
        authenticate: async () => {
          throw Error('Token required');
        },
        validateToken: createDaemonTokenValidator(
          async (token) =>
            (await jwtVerify(token, new TextEncoder().encode(secret), { issuer: 'omnitron', algorithms: ['HS256'] }))
              .payload,
          null
        ),
      }),
      new AuthorizationManager(logger)
    );
    host.registerTransport('tcp', () => new TcpTransport());
    const withAuth = createAuthContextWrapper();
    host.registerTransportServer('tcp', {
      name: 'tcp',
      options: {
        host: '127.0.0.1',
        port: 0,
        invocationWrapper: (metadata: Map<string, unknown>, action: () => Promise<unknown>) => {
          if (metadata.get('methodName') === 'receive') receives++;
          return withAuth(metadata, action);
        },
      },
    });
    await host.start();
    await host.peer.exposeService(new Liveness());
    await host.peer.exposeService(receiverRpc);
    await host.peer.exposeService(
      new FlowReviewPeerRpcService({
        get ledger() {
          return receiver;
        },
        scope: destination.scope,
        admit,
      })
    );
    const port = (host.transportServers.get('tcp') as { port: number }).port;
    return { secret, port, host: '127.0.0.1' as const, nodeId };
  }
  const selection = () => ({ workspace, id: flowId, nodeId, revision });
  async function prepare(transferId: string = randomUUID()) {
    return actor('sender', () => senderRpc.prepare({ ...selection(), transferId }));
  }
  it('requires active human administration, a project registration, neutral components and an immutable selection', async () => {
    const offer = await prepare();
    expect(await prepare(offer.transferId)).toEqual(offer);
    expect(JSON.stringify(offer)).not.toContain(definition.name);
    await expect(actor('reader', () => receiverRpc.invite({ workspace, offer }), 'viewer')).rejects.toThrow(/admin/);
    await expect(
      actor('receiver', () => receiverRpc.invite({ workspace: { project: 'other' }, offer }))
    ).rejects.toThrow(/another project/);
    const invite = await actor('receiver', () => receiverRpc.invite({ workspace, offer }));
    expect(invite.destinationRegistration).not.toBe(offer.sourceRegistration);
    const altered = { ...offer, digest: 'a'.repeat(64) };
    await expect(actor('receiver', () => receiverRpc.invite({ workspace, offer: altered }))).rejects.toThrow(
      /different graph/
    );
    await expect(
      actor('other-admin', () => senderRpc.deliver({ ...selection(), invitation: invite, mode: 'send' }))
    ).rejects.toThrow(/changed/);
    const disk = sender.save(
      { workspace, id: randomUUID(), definition: diskSpaceFlow('/', 10, 20), expectedRevision: null },
      await source.scope(workspace)
    );
    await expect(
      actor('sender', () =>
        senderRpc.prepare({ ...selection(), id: disk.id, revision: disk.revision, transferId: randomUUID() })
      )
    ).rejects.toThrow(/manual input/);
    source.replace();
    await expect(prepare(offer.transferId)).rejects.toThrow(/registration changed/);
    await expect(
      actor('sender', () => senderRpc.deliver({ ...selection(), invitation: invite, mode: 'send' }))
    ).rejects.toThrow(/changed/);
    expect(receiver.list({ workspace }).items).toEqual([]);
  });
  it('rejects a direct authenticated Netron connection for private flow transfer', async () => {
    const target = await listening();
    connector = new SlaveConnector(logger, {} as never, {
      dial: async (data) => ({
        ...(await directLink(data)),
        token: await mintServiceToken(target.secret, 'sender-controller'),
      }),
    });
    await connector.addSlave(target);
    expect(await connector.waitUntilConnected(target.host, target.port, 3000)).toBe(true);
    expect(connector.getConnections()[0]?.authenticated).toBe(true);
    await expect(
      connector.invokeOnSlave(target.host, target.port, 'OmnitronFlowReviews', 'invite', [
        { workspace, offer: await prepare() },
      ])
    ).rejects.toThrow();
    expect(() =>
      connector!.pinnedService(target.host, target.port, nodeId, 'enrollment', 'OmnitronFlowReviewPeer')
    ).toThrow(/management connection/);
    await expect(
      new FlowReviewPeerRpcService({ ledger: receiver, scope: destination.scope, admit }).probe({} as never)
    ).rejects.toThrow(/authenticated management peer/);
  });
  it.skipIf(!existsSync(process.env['OMNITRON_TEST_SSHD'] ?? '/usr/sbin/sshd'))(
    'verifies the OpenSSH host and installation on the same Netron peer, recovers a lost reply after restart and rejects a replaced project',
    async () => {
      const target = await listening();
      const ssh = await privateSshServer(directory, target.port, target.secret, (child) => {
        sshd = child;
      });
      execution = new ExecutionService(logger);
      const dial = createMeshDialer({ logger, execution, subject: 'sender-controller', sshTargetFor: async () => ssh });
      const managementIdentity = meshManagementIdentity(target.nodeId, ssh);
      connector = new SlaveConnector(logger, {} as never, { dial });
      async function connect() {
        await connector!.addSlave(target);
        expect(await connector!.waitUntilConnected(target.host, target.port, 8000)).toBe(true);
      }
      await connect();
      expect(connector.getConnections()[0]).toMatchObject({ authenticated: true, via: 'ssh-tunnel' });
      const changedHost = {
        ...ssh,
        expectedHostFingerprint: 'SHA256:' + randomBytes(32).toString('base64').replace(/=+$/, ''),
      };
      const hostCheck = await execution.ssh(changedHost, 'true', { timeout: 2500, quiet: true }).then(
        (result) => result.exitCode !== 0,
        () => true
      );
      expect(hostCheck).toBe(true);
      expect(() =>
        connector!.pinnedService(target.host, target.port, nodeId, 'unapproved key', 'OmnitronFlowReviewPeer')
      ).toThrow(/management connection/);
      const open = () =>
        connector!.pinnedService(target.host, target.port, nodeId, managementIdentity, 'OmnitronFlowReviewPeer');
      let lost = false,
        afterProof: undefined | (() => Promise<void>);
      route = {
        pin: managementIdentity,
        open() {
          const samePeer = open();
          return async (method, data, beforeSend) => {
            if (method === 'receive') expect(JSON.stringify(data)).not.toContain('Local review is ready');
            const result = await samePeer(method, data, beforeSend);
            if (method === 'probe' && afterProof) {
              const change = afterProof;
              afterProof = undefined;
              await change();
            }
            if (method === 'receive' && lost) {
              lost = false;
              throw Error('Receipt confirmation was lost');
            }
            return result;
          };
        },
      };
      const acceptOffer = async () => {
        const offer = await prepare();
        return actor('receiver', () => receiverRpc.invite({ workspace, offer }));
      };
      const invite = await acceptOffer();
      const deliver = (invitation: typeof invite, mode: 'send' | 'receipt' = 'send') =>
        actor('sender', () => senderRpc.deliver({ ...selection(), invitation, mode }));
      const incoming = () => actor('receiver', () => receiverRpc.incomingReceipt({ workspace, offer: invite.offer }));
      expect(await incoming()).toBeNull();
      expect(await deliver(invite, 'receipt')).toBeNull();
      expect(receives).toBe(0);
      const tampered = { ...invite, destinationRegistration: '1'.repeat(64) };
      await expect(deliver(tampered)).rejects.toThrow();
      expect(receives).toBe(0);
      const revoked = await acceptOffer();
      await actor('receiver', () => receiverRpc.revoke({ workspace, offer: revoked.offer }));
      await expect(deliver(revoked)).rejects.toThrow(/revoked/i);
      expect(receives).toBe(0);
      const original = receiver,
        replacementDb = new Database(':memory:');
      receiver = new FlowLedger(replacementDb);
      try {
        await expect(deliver(invite)).rejects.toThrow(/no invitation/);
        expect(receives).toBe(0);
      } finally {
        receiver = original;
        replacementDb.close();
      }
      afterProof = async () => {
        await connector!.removeSlave(target.host, target.port);
        await connect();
      };
      await expect(deliver(invite)).rejects.toThrow(/connection changed/);
      expect(receives).toBe(0);
      expect(receiver.list({ workspace }).items).toEqual([]);
      lost = true;
      await expect(deliver(invite)).rejects.toThrow(/confirmation was lost/);
      expect(receives).toBe(1);
      const [item] = receiver.list({ workspace }).items;
      expect(item).toBeDefined();
      const received = receiver.get({ workspace, id: item!.id });
      expect(received).toMatchObject({ active: null, definition });
      expect(receiver.history({ workspace, id: item!.id })).toEqual([]);
      const receipt: FlowSubmissionReceipt = { id: item!.id, revision: received.revision, workspace };
      expect(receipt.revision).not.toBe(revision);
      const pending = await acceptOffer();
      const journals = () => ({
        outgoing: senderDB
          .prepare('SELECT id,identity,offer,ticket,receipt FROM flow_review_outgoing ORDER BY id')
          .all(),
        incoming: receiverDB
          .prepare('SELECT id,invitation,revoked,receipt FROM flow_review_incoming ORDER BY id')
          .all(),
      });
      const originalJournals = journals();
      senderDB.close();
      receiverDB.close();
      senderDB = new Database(join(directory, 'source.sqlite'));
      receiverDB = new Database(join(directory, 'destination.sqlite'));
      // Release qualification points to an immutable checkout of the outgoing runtime.
      const previousModule = process.env['OMNITRON_TEST_PREVIOUS_FLOW_LEDGER'];
      const PreviousLedger: typeof FlowLedger = previousModule
        ? (await import(/* @vite-ignore */ previousModule)).FlowLedger
        : FlowLedger;
      const previousSource = new PreviousLedger(senderDB);
      const previousDestination = new PreviousLedger(receiverDB);
      if (previousModule) {
        expect(previousSource).not.toHaveProperty('peerReviews');
        expect(previousDestination).not.toHaveProperty('peerReviews');
      }
      expect(previousSource.list({ workspace }).items).toHaveLength(1);
      expect(previousDestination.get(receipt)).toMatchObject({ active: null, revision: receipt.revision, definition });
      previousDestination.save(
        {
          workspace,
          id: receipt.id,
          expectedRevision: receipt.revision,
          definition: { ...definition, name: 'Local edit' },
        },
        await destination.scope(workspace)
      );
      expect(previousDestination.history(receipt)).toEqual([]);
      expect(journals()).toEqual(originalJournals);
      senderDB.close();
      receiverDB.close();
      senderDB = new Database(join(directory, 'source.sqlite'));
      receiverDB = new Database(join(directory, 'destination.sqlite'));
      sender = new FlowLedger(senderDB, defaultFlowRegistry, () => now);
      receiver = new FlowLedger(receiverDB, defaultFlowRegistry, () => now);
      await connector.removeSlave(target.host, target.port);
      await connect();
      now += invitationLifetime + 1;
      const beforeRecovery = receives;
      await expect(deliver(revoked)).rejects.toThrow(/revoked/);
      await expect(deliver(pending)).rejects.toThrow(/expired/);
      expect(await incoming()).toEqual(receipt);
      expect(await deliver(invite, 'receipt')).toEqual(receipt);
      expect(await deliver(invite)).toEqual(receipt);
      expect(receives).toBe(beforeRecovery);
      const senderKey = (
        senderDB.prepare('SELECT signing FROM flow_review_outgoing WHERE id=?').get(invite.offer.transferId) as {
          signing: string;
        }
      ).signing;
      const ciphertext = await encryptGraph(invite, { ...definition, name: 'A different graph' }),
        nonce = randomUUID(),
        ticket = digest(invite);
      await expect(
        open()('receive', {
          transferId: invite.offer.transferId,
          ticket,
          nonce,
          ciphertext,
          signature: signature(senderKey, 'receive', ticket, nonce, digest(ciphertext)),
        })
      ).rejects.toThrow(/differs from the approved offer/);
      await expect(actor('receiver', () => receiverRpc.revoke({ workspace, offer: invite.offer }))).rejects.toThrow(
        /already produced/
      );
      const expired = await acceptOffer();
      now += invitationLifetime + 1;
      await expect(deliver(expired)).rejects.toThrow(/expired/);
      expect(receives).toBe(beforeRecovery + 1);
      const concurrent = await acceptOffer();
      const duplicates = await Promise.all([deliver(concurrent), deliver(concurrent)]);
      expect(duplicates[0]).toEqual(duplicates[1]);
      expect(duplicates[0]?.id).not.toBe(receipt.id);
      const withdrawn = await acceptOffer();
      afterProof = () => actor('receiver', () => receiverRpc.revoke({ workspace, offer: withdrawn.offer }));
      await expect(deliver(withdrawn)).rejects.toThrow(/revoked/);
      const oldRegistration = await acceptOffer();
      const confirmedSends = receives;
      destination.replace();
      await expect(deliver(oldRegistration)).rejects.toThrow(/registration changed/);
      expect(receives).toBe(confirmedSends);
      expect(receiver.list({ workspace }).items).toHaveLength(2);
    },
    40000
  );
});
