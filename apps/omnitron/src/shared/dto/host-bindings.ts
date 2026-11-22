/** Profiles in the order used by host binding reviews and installation receipts. */
export const HOST_BINDING_NAMES = ['bitcoin', 'monero-daemon', 'monero-wallet-rpc'] as const;
export type HostBindingProfile = (typeof HOST_BINDING_NAMES)[number];

export interface HostBindingSelection { project: string; stack: string; release: string; nodeId: string }
export interface HostBindingReview extends HostBindingSelection {
  protocol: 1;
  commit: string;
  manifestSha256: string;
  sshFingerprint: string;
  referencesSha256: string;
  bindings: Array<{
    name: string;
    unit: string;
    user: string;
    config: string;
    chainDataDir: string | null;
    unitSha256: string;
    templateSha256: string;
  }>;
  digest: string;
}

export type HostConfigGrant = { ticket: string; nodeId: string; review: string };
export type HostConfigInstallRequest = HostConfigGrant & { project: string; stack: string; release: string; prepared: string };
export type HostConfigReceipt = HostConfigGrant & { protocol: 1; files: Array<{ profile: HostBindingProfile; receipt: string }> };

export interface WalletMembershipRequest {
  project: string;
  stack: string;
  nodeId: string;
  fingerprint: string;
  unit: 'monero-walletd.service' | 'monero-wallet-rpc.service';
  port: number;
  userRef: string;
  passwordRef: string;
  nonce: string;
  members: string[];
  /** Resolve the matching, node-local ledger by its nonce for reverse index verification. */
  lookup?: 'node-ledger';
}

export interface WalletMembershipReceipt {
  primarySha256: string;
  membershipSha256: string;
  checked: number;
  matched: number;
  indexed?: {
    /** The wallet recognizes the spend key but cannot reproduce the full address from its issued indices. */
    indexOnly: number;
    otherAccountMatches: number;
    matchedSetSha256: string;
  };
}
