/** Host-owned ingress has an independent lifetime from every application stack. */
export interface HostIngressSettings {
  /** An immutable OpenResty image reference (repository@sha256:...). */
  image: string;
  httpPort: number;
  httpsPort: number;
  controlPort: number;
  /** Host-owned source directory. Keys are copied into immutable host snapshots. */
  certificateRoot: string;
  proxyPolicy: { mode: 'cloudflare-only'; trustedCidrs: string[]; allowLoopbackProbes?: boolean } | { mode: 'direct'; trustedCidrs: [] };
}
export interface HostIngressOwner { project: string; stack: string; app: string }
export interface HostIngressUpstream { host: '127.0.0.1' | '::1'; port: number }
export type HostIngressLocation =
  | { path: string; upstream: HostIngressUpstream; stripPrefix: boolean }
  | { path: string; deny: 403 | 404 | 410 };
export interface HostIngressRoute {
  domains: string[];
  /** Request body limit; defaults to 16 MiB, maximum 128 MiB. */
  maxBodyBytes?: number;
  tls: { certificate: string; privateKey: string };
  locations: HostIngressLocation[];
}
export interface HostIngressApplication {
  owner: HostIngressOwner;
  /** Every app/container TCP port, including non-HTTP services. */
  reservedPorts: number[];
  routes: HostIngressRoute[];
}
export interface HostIngressTakeover {
  containerId: string;
  containerName: string;
  expectedLabels: Record<string, string>;
  probe: { domain: string; path: string; status: number; certificateSha256: string };
}
export interface HostIngressTakeoverSnapshot {
  descriptor: HostIngressTakeover;
  restartPolicy: { name: 'no' | 'always' | 'unless-stopped' | 'on-failure'; maximumRetryCount: number };
  image: string;
  wasRunning: true;
}
export interface HostIngressTakeoverRecord {
  generation: string;
  snapshot: HostIngressTakeoverSnapshot;
  outcome: 'committed' | 'rolled-back';
}
export interface HostIngressTakeoverRollback { expectedGeneration: string }
export interface HostIngressTakeoverRollbackReceipt {
  rolledBack: true;
  previousGeneration: string;
  generation: null;
  legacyContainerId: string;
  legacyVerified: true;
}
export interface HostIngressApply extends HostIngressApplication {
  expectedGeneration: string | null;
  /** Guards the exact content recorded by a prior check/validate receipt. */
  preparedOwnerRevision?: string;
  /** Explicit first publication only, never implicit adoption of a listener. */
  takeover?: HostIngressTakeover;
}
export interface HostIngressCheck {
  valid: true;
  generation: string | null;
  owner: HostIngressOwner;
  reservedPorts: number[];
  domains: string[];
  /** This read-only preflight does not replace publication's native nginx -t. */
  nativeConfigValidated: false;
  ownerRevision: string;
}
export interface HostIngressValidation extends Omit<HostIngressCheck, 'nativeConfigValidated'> {
  nativeConfigValidated: true;
  candidateGeneration: string;
}
export interface HostIngressOwnerRestore {
  owner: HostIngressOwner;
  fromGeneration: string | null;
  expectedGeneration: string;
  expectedOwnerRevision: string | null;
}
export interface HostIngressRemove { owner: HostIngressOwner; expectedGeneration: string | null }
export interface StoredIngressRoute extends HostIngressRoute { certificateObject: string }
export interface StoredIngressApplication extends Omit<HostIngressApplication, 'routes'> { routes: StoredIngressRoute[] }
export interface HostIngressManifest {
  version: 1;
  generation: string;
  sequence: number;
  applications: StoredIngressApplication[];
}
export interface HostIngressStatus {
  configured: boolean;
  settings: HostIngressSettings | null;
  generation: string | null;
  applications: StoredIngressApplication[];
  ownerRevisions: Array<{ owner: HostIngressOwner; revision: string }>;
  takeover: HostIngressTakeoverRecord | null;
  observedGeneration: string | null;
  recoveryPending: boolean;
}
export interface HostIngressReceipt {
  generation: string;
  previousGeneration: string | null;
  observedGeneration: string;
  changed: boolean;
  owner: HostIngressOwner;
  ownerRevision: string | null;
  takeover?: { containerId: string; containerName: string; retained: true };
}
export interface HostIngressRuntime {
  inspectTakeover(settings: HostIngressSettings, descriptor: HostIngressTakeover): Promise<HostIngressTakeoverSnapshot>;
  quiesceTakeover(snapshot: HostIngressTakeoverSnapshot): Promise<void>;
  restoreTakeover(settings: HostIngressSettings, snapshot: HostIngressTakeoverSnapshot): Promise<void>;
  verifyRetiredTakeover(snapshot: HostIngressTakeoverSnapshot): Promise<void>;
  /** Refuse foreign or differently configured containers; return whether ours exists. */
  inspect(settings: HostIngressSettings): Promise<{ exists: boolean; running: boolean }>;
  validate(settings: HostIngressSettings, generation: string): Promise<void>;
  activate(settings: HostIngressSettings): Promise<void>;
  acknowledge(settings: HostIngressSettings, generation: string): Promise<void>;
  observed(settings: HostIngressSettings): Promise<string | null>;
  /** Used only to undo an initial failed publication; never touches another container. */
  remove(settings: HostIngressSettings): Promise<void>;
}
