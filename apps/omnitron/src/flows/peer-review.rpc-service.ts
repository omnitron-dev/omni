import { randomUUID } from 'node:crypto';
import { Public, Service } from '@omnitron-dev/titan/decorators';
import { getCurrentInvocationContext } from '@omnitron-dev/titan/netron';
import { daemonPrincipal } from '../services/daemon-principal.js';
import type { AuditService } from '../services/audit.service.js';
import type { AuthService } from '../services/auth.service.js';
import type {
  FlowReviewSelection,
  FlowReviewInvitation,
  FlowReviewProbe,
  FlowReviewResponse,
  IFlowReviewPeer,
  IFlowReviewService,
} from '../shared/dto/flow-peer-review.js';
import { isReviewId } from '../shared/dto/flow-peer-review.js';
import type { FlowSubmissionReceipt } from '../shared/dto/flow-runtime.js';
import { ADMIN_ROLES } from '../shared/roles.js';
import type { FlowLedger } from './flow-ledger.js';
import type { FlowScopeReader } from './flow-runtime.js';
import {
  checkSignature,
  decryptGraph,
  digest,
  encryptGraph,
  fields,
  invitationDocument,
  offerDocument,
  portable,
  projectScope,
  same,
  signature,
} from './peer-review-crypto.js';

type Method<T extends keyof IFlowReviewService> = Parameters<IFlowReviewService[T]>[0];
type Dependencies = { ledger: FlowLedger; scope: FlowScopeReader; admit(): Promise<void> };
export interface FlowReviewRoute {
  pin: string;
  open(): (method: keyof IFlowReviewPeer, payload: unknown, beforeSend?: () => Promise<void>) => Promise<unknown>;
}

function selection(data: FlowReviewSelection): FlowReviewSelection {
  projectScope(data.workspace);
  if (
    !isReviewId(data.id) ||
    !isReviewId(data.nodeId) ||
    typeof data.revision !== 'string' ||
    !/^[0-9a-f]{64}$/.test(data.revision)
  )
    throw Error('Select an exact saved revision and enrolled node');
  return { workspace: data.workspace, id: data.id, revision: data.revision, nodeId: data.nodeId };
}
function confirmed(invite: FlowReviewInvitation, nonce: string, purpose: string, value: unknown) {
  const answer = value as FlowReviewResponse;
  if (!fields(answer, ['receipt', 'proof'])) throw Error('Unconfirmed flow transfer');
  const receipt = answer.receipt;
  if (
    receipt !== null &&
    (!fields(receipt, ['id', 'workspace', 'revision']) ||
      !isReviewId(receipt.id) ||
      !same(receipt.workspace, invite.offer.workspace) ||
      typeof receipt.revision !== 'string' ||
      !/^[0-9a-f]{64}$/.test(receipt.revision))
  )
    throw Error('Invalid destination receipt');
  checkSignature(invite.destinationKey, answer.proof, purpose + '-answer', digest(invite), nonce, receipt);
  return receipt;
}

@Service({ name: 'OmnitronFlowReviews' })
export class FlowReviewRpcService implements IFlowReviewService {
  constructor(
    private readonly host: Dependencies,
    private readonly auth: Pick<AuthService, 'validateSession'>,
    private readonly audit: Pick<AuditService, 'record'>,
    private readonly route: (id: string) => FlowReviewRoute
  ) {}
  private async human() {
    return (await daemonPrincipal(this.auth, 'admin')).context.userId;
  }
  private async action(name: string, id: string) {
    await this.host.admit();
    await this.audit.record({ action: 'flow.peer.' + name, resourceType: 'flow-transfer', resourceId: id }, true);
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  async prepare(data: Method<'prepare'>) {
    const actor = await this.human();
    if (!fields(data, ['workspace', 'id', 'revision', 'nodeId', 'transferId']) || !isReviewId(data.transferId))
      throw Error('Select a transfer ID');
    const ref = selection(data);
    await this.action('prepare', data.transferId);
    const binding = await this.host.scope(ref.workspace);
    const registration = digest(binding);
    const pin = this.route(ref.nodeId).pin;
    const graph = this.host.ledger.reviewedGraph(ref, ref.revision, binding);
    portable(graph, this.host.ledger.registry);
    return this.host.ledger.peerReviews.prepare(
      data.transferId,
      this.host.ledger.peerReviews.identity(actor, ref, registration, pin),
      ref.workspace,
      registration,
      ref.revision,
      graph
    );
  }
  private async receivingProject(data: Method<'invite'>, action?: 'invite' | 'revoke') {
    await this.human();
    if (!fields(data, ['workspace', 'offer'])) throw Error('Select the offer and destination project');
    offerDocument(data.offer);
    projectScope(data.workspace);
    if (!same(data.workspace, data.offer.workspace)) throw Error('The offer names another project or stack');
    if (action) await this.action(action, data.offer.transferId);
    return digest(await this.host.scope(data.workspace));
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  async invite(data: Method<'invite'>) {
    const registration = await this.receivingProject(data, 'invite');
    return this.host.ledger.peerReviews.invite(data.offer, registration);
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  async revoke(data: Method<'revoke'>) {
    const registration = await this.receivingProject(data, 'revoke');
    this.host.ledger.peerReviews.revoke(data.offer, registration);
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  async incomingReceipt(data: Method<'incomingReceipt'>) {
    const registration = await this.receivingProject(data);
    const info = this.host.ledger.peerReviews;
    const entry = info.issuedFor(data.offer, registration);
    info.requireLive(entry);
    return entry.receipt;
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  async deliver(data: Method<'deliver'>): Promise<FlowSubmissionReceipt | null> {
    const actor = await this.human();
    if (
      !fields(data, ['workspace', 'id', 'revision', 'nodeId', 'invitation', 'mode']) ||
      !['receipt', 'send'].includes(data.mode)
    )
      throw Error('Select delivery or receipt lookup');
    const ref = selection(data);
    const invite = data.invitation;
    invitationDocument(invite);
    const info = this.host.ledger.peerReviews;
    const check = async () => {
      if ((await this.human()) !== actor) throw Error('The submitting account changed');
      await this.host.admit();
      const binding = await this.host.scope(ref.workspace);
      const route = this.route(ref.nodeId);
      const identity = info.identity(actor, ref, digest(binding), route.pin);
      return { route, identity, binding, row: info.outboundFor(invite, identity, false) };
    };
    const { route, identity, row } = await check();
    if (row.receipt) return JSON.parse(row.receipt) as FlowSubmissionReceipt;
    const call = route.open();
    const ticket = digest(invite),
      transferId = invite.offer.transferId,
      nonce = randomUUID();
    const proof = (purpose: string, ...extra: unknown[]) => signature(row.signing, purpose, ticket, nonce, ...extra);
    const probe = { transferId, ticket, nonce, signature: proof('probe') };
    let receipt = confirmed(invite, nonce, 'probe', await call('probe', probe));
    if (!receipt && data.mode === 'send') {
      if (Date.now() >= invite.expiresAt) throw Error('The flow review invitation has expired');
      await this.action('deliver', transferId);
      const ciphertext = await encryptGraph(invite, JSON.parse(row.graph));
      const request = { transferId, ticket, nonce, signature: proof('receive', digest(ciphertext)), ciphertext };
      info.outboundFor(invite, identity, true);
      const reply = await call('receive', request, async () => {
        const { binding } = await check();
        this.host.ledger.reviewedGraph(ref, ref.revision, binding);
        if (Date.now() >= invite.expiresAt) throw Error('The flow review invitation has expired');
      });
      receipt = confirmed(invite, nonce, 'receive', reply);
      if (!receipt) throw Error('Delivery unconfirmed. Check the original transfer receipt.');
    }
    if (receipt) {
      info.outboundFor(invite, identity, true);
      info.acknowledge(transferId, receipt);
    }
    return receipt;
  }
}

@Service({ name: 'OmnitronFlowReviewPeer' })
export class FlowReviewPeerRpcService implements IFlowReviewPeer {
  constructor(private host: Dependencies) {}
  private async admitted(data: FlowReviewProbe, purpose: 'probe' | 'receive', ciphertext?: string) {
    const call = getCurrentInvocationContext(),
      who = call?.auth;
    if (
      call?.transport !== 'tcp' ||
      who?.roles.length !== 1 ||
      who.roles[0] !== 'service_role' ||
      who.metadata?.['principalType'] !== 'service' ||
      typeof who.metadata['expiresAt'] !== 'number' ||
      !Number.isFinite(who.metadata['expiresAt']) ||
      who.metadata['expiresAt'] <= Date.now()
    )
      throw Error('An authenticated management peer is required');
    if (
      !fields(
        data,
        purpose === 'probe'
          ? ['transferId', 'ticket', 'nonce', 'signature']
          : ['transferId', 'ticket', 'nonce', 'signature', 'ciphertext']
      ) ||
      !isReviewId(data.transferId) ||
      !isReviewId(data.nonce) ||
      typeof data.ticket !== 'string' ||
      data.ticket.length !== 64 ||
      (purpose === 'receive' && (typeof ciphertext !== 'string' || ciphertext.length > 100000))
    )
      throw Error('Invalid flow transfer request');
    await this.host.admit();
    const info = this.host.ledger.peerReviews;
    const entry = info.incoming(data.transferId);
    if (digest(entry.invitation) !== data.ticket) throw Error('Invitation belongs to another destination');
    checkSignature(
      entry.invitation.offer.senderKey,
      data.signature,
      purpose,
      data.ticket,
      data.nonce,
      ...(purpose === 'receive' ? [digest(ciphertext)] : [])
    );
    const binding = await this.host.scope(entry.invitation.offer.workspace);
    if (digest(binding) !== entry.invitation.destinationRegistration)
      throw Error('The destination project registration changed');
    const latest = info.incoming(data.transferId);
    info.requireLive(latest);
    return latest;
  }
  private reply(
    key: string,
    purpose: string,
    data: FlowReviewProbe,
    receipt: FlowSubmissionReceipt | null
  ): FlowReviewResponse {
    return { receipt, proof: signature(key, purpose + '-answer', data.ticket, data.nonce, receipt) };
  }
  @Public({ auth: { roles: ['service_role'] } })
  async probe(data: FlowReviewProbe) {
    const entry = await this.admitted(data, 'probe');
    return this.reply(entry.row.signing, 'probe', data, entry.receipt);
  }
  @Public({ auth: { roles: ['service_role'] } })
  async receive(data: FlowReviewProbe & { ciphertext: string }) {
    const entry = await this.admitted(data, 'receive', data.ciphertext);
    const graph = await decryptGraph(entry.row.encryption, data.ciphertext);
    portable(graph, this.host.ledger.registry);
    if (digest(graph) !== entry.invitation.offer.digest) throw Error('The graph differs from the approved offer');
    let receipt = entry.receipt;
    if (!receipt) {
      await this.host.admit();
      const binding = await this.host.scope(entry.invitation.offer.workspace);
      receipt = this.host.ledger.peerReviews.accept(entry.invitation, graph, binding);
    }
    return this.reply(entry.row.signing, 'receive', data, receipt);
  }
}
