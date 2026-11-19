import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import { stableJson } from '../shared/canonical-json.js';
import type { FlowDefinition } from '../shared/dto/flows.js';
import type { FlowSubmissionReceipt, FlowWorkspace } from '../shared/dto/flow-runtime.js';
import type { FlowReviewOffer, FlowReviewInvitation, FlowReviewSelection } from '../shared/dto/flow-peer-review.js';
import { digest, keys, same } from './peer-review-crypto.js';
import type { FlowBinding } from './flow-ledger.js';

type Database = ReturnType<DaemonStateStore['initSync']>;
interface Outgoing {
  identity: string;
  offer: string;
  graph: string;
  signing: string;
  ticket: string | null;
  receipt: string | null;
}
interface Incoming {
  invitation: string;
  signing: string;
  encryption: string;
  revoked: number;
  receipt: string | null;
}
export const invitationLifetime = 10 * 60_000;

/** All private keys and the reviewed source snapshot live in the owning controller's private SQLite ledger. */
export class PeerReviewLedger {
  constructor(
    private db: Database,
    private commit: <T>(work: () => T) => T,
    private insert: (workspace: FlowWorkspace, graph: FlowDefinition, binding: FlowBinding) => FlowSubmissionReceipt,
    private now: () => number
  ) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS flow_review_outgoing (
        id TEXT PRIMARY KEY, identity TEXT NOT NULL, offer TEXT NOT NULL, graph TEXT NOT NULL, signing TEXT NOT NULL, ticket TEXT, receipt TEXT
      );
      CREATE TABLE IF NOT EXISTS flow_review_incoming (
        id TEXT PRIMARY KEY, invitation TEXT NOT NULL, signing TEXT NOT NULL, encryption TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, receipt TEXT
      );
    `);
  }
  prepare(
    id: string,
    identity: string,
    workspace: FlowWorkspace,
    registration: string,
    sourceRevision: string,
    graph: FlowDefinition
  ): FlowReviewOffer {
    return this.commit(() => {
      const prior = this.outbound(id);
      if (prior) {
        if (prior.identity !== identity) throw Error('Transfer ID belongs to a different selection');
        return JSON.parse(prior.offer);
      }
      const signer = keys('ed25519');
      const offer: FlowReviewOffer = {
        version: 1,
        transferId: id,
        workspace,
        sourceRegistration: registration,
        sourceRevision,
        digest: digest(graph),
        senderKey: signer.public,
      };
      this.db
        .prepare('INSERT INTO flow_review_outgoing(id,identity,offer,graph,signing) VALUES(?,?,?,?,?)')
        .run(id, identity, stableJson(offer), stableJson(graph), signer.private);
      return offer;
    });
  }
  identity(actor: string, selection: FlowReviewSelection, registration: string, nodePin: string) {
    return digest([actor, selection, registration, nodePin]);
  }
  private outbound(id: string) {
    return this.db.prepare('SELECT * FROM flow_review_outgoing WHERE id=?').get(id) as Outgoing | undefined;
  }
  outboundFor(invite: FlowReviewInvitation, identity: string, bind: boolean) {
    const read = () => {
      const row = this.outbound(invite.offer.transferId),
        ticket = digest(invite);
      if (
        !row ||
        row.identity !== identity ||
        row.offer !== stableJson(invite.offer) ||
        (row.ticket !== null && row.ticket !== ticket)
      )
        throw Error('The offer, source workspace, recipient or reviewed revision has changed');
      if (bind && row.ticket === null)
        this.db.prepare('UPDATE flow_review_outgoing SET ticket=? WHERE id=?').run(ticket, invite.offer.transferId);
      return row;
    };
    return bind ? this.commit(read) : read();
  }
  acknowledge(id: string, receipt: FlowSubmissionReceipt) {
    this.commit(() =>
      this.db.prepare('UPDATE flow_review_outgoing SET receipt=? WHERE id=?').run(stableJson(receipt), id)
    );
  }
  incoming(id: string) {
    const row = this.db.prepare('SELECT * FROM flow_review_incoming WHERE id=?').get(id) as Incoming | undefined;
    if (!row) throw Error('This controller has no invitation for that transfer');
    return {
      row,
      invitation: JSON.parse(row.invitation) as FlowReviewInvitation,
      receipt: row.receipt ? (JSON.parse(row.receipt) as FlowSubmissionReceipt) : null,
    };
  }
  issuedFor(offer: FlowReviewOffer, registration: string) {
    const entry = this.incoming(offer.transferId);
    if (!same(entry.invitation.offer, offer) || entry.invitation.destinationRegistration !== registration)
      throw Error('This offer ID is bound to a different graph or project registration');
    return entry;
  }
  invite(offer: FlowReviewOffer, registration: string): FlowReviewInvitation {
    return this.commit(() => {
      const found = this.db.prepare('SELECT 1 FROM flow_review_incoming WHERE id=?').get(offer.transferId);
      if (found) {
        const existing = this.issuedFor(offer, registration);
        this.requireLive(existing);
        return existing.invitation;
      }
      const signing = keys('ed25519'),
        encryption = keys('x25519');
      const invitation: FlowReviewInvitation = {
        offer,
        destinationRegistration: registration,
        expiresAt: this.now() + invitationLifetime,
        destinationKey: signing.public,
        encryptionKey: encryption.public,
      };
      this.db
        .prepare('INSERT INTO flow_review_incoming(id,invitation,signing,encryption) VALUES(?,?,?,?)')
        .run(offer.transferId, stableJson(invitation), signing.private, encryption.private);
      return invitation;
    });
  }
  requireLive(entry: ReturnType<PeerReviewLedger['incoming']>) {
    if (entry.row.revoked) throw Error('The receiving administrator revoked this invitation');
    if (!entry.receipt && this.now() >= entry.invitation.expiresAt)
      throw Error('The flow review invitation has expired');
  }
  revoke(offer: FlowReviewOffer, registration: string) {
    this.commit(() => {
      const current = this.issuedFor(offer, registration);
      if (current.receipt) throw Error('This invitation already produced a draft');
      this.db.prepare('UPDATE flow_review_incoming SET revoked=1 WHERE id=?').run(offer.transferId);
    });
  }
  accept(invite: FlowReviewInvitation, graph: FlowDefinition, binding: FlowBinding) {
    return this.commit(() => {
      const entry = this.incoming(invite.offer.transferId);
      if (
        !same(entry.invitation, invite) ||
        digest(binding) !== invite.destinationRegistration ||
        digest(graph) !== invite.offer.digest
      )
        throw Error('Reviewed graph or destination registration changed');
      this.requireLive(entry);
      if (entry.receipt) return entry.receipt;
      const receipt = this.insert(invite.offer.workspace, graph, binding);
      this.db
        .prepare('UPDATE flow_review_incoming SET receipt=? WHERE id=?')
        .run(stableJson(receipt), invite.offer.transferId);
      return receipt;
    });
  }
}
