export interface DevelopmentSdkStatus {
  mode: 'development' | 'registry';
  verifiedImports: number;
  source?: string;
  distributionLock?: 'present' | 'absent' | 'manager-only';
  distributionLockChanged?: boolean;
  transition?: { id: string; phase: 'committed' | 'restored' | 'superseded'; source: string;
    adoption?: { review: string; launch: 'unconfirmed'; history: string } };
  build?: { status: 'current'; packages: string[] };
  refresh?: { stack: string; confirmed: string[]; inactive: string[]; optedOut: string[]; unaffected: string[] };
}
export interface DevelopmentSdkProfile {
  schema: 1;
  root: string;
  source: string;
  links: Record<string, string>;
  lockSha256?: string | null;
  versions?: Record<string, string>;
  inputSha256?: string;
}
export interface MigrationSdkInspection {
  root: string;
  source: string | null;
  bindings: Readonly<Record<string, string>>;
  workspaces: import('./sdk-operation.js').SdkWorkspaceIdentity[];
  inputsSha256: string;
}
export type { MigrationSdkReference, MigrationSdkHold, SdkWorkspaceIdentity } from './sdk-operation.js';
export { releaseTerminalMigrationSdk } from './sdk-operation.js';
export function inspectMigrationSdk(projectDirectory: string): Promise<MigrationSdkInspection>;
export function withMigrationSdk<T>(projectDirectory: string, reference: import('./sdk-operation.js').MigrationSdkReference,
  body: (hold: import('./sdk-operation.js').MigrationSdkHold) => Promise<T>): Promise<T>;
export function sdkCommand(args: string[]): Promise<void>;
export type DevelopmentSdkSelectionCheck = { root: string; source: string; reason: string } & (
  | { action: 'reuse'; snapshotRequired: false; reuseDigest: string }
  | { action: 'rebuild' | 'rebind'; snapshotRequired: true }
  | { action: 'unconfirmed'; snapshotRequired: null }
);
export function inspectDevelopmentSdkSelection(projectDirectory: string, checkout?: string): Promise<DevelopmentSdkSelectionCheck>;
export function prepareDevelopmentSdk(projectDirectory: string, checkout?: string): Promise<{
  root: string; source: string; token: string; paths: number; bytes: number;
  projectRevision: string | { unborn: string } | null; sourceRevision: string | { unborn: string } | null;
}>;
export function inspectSdk(projectDirectory?: string, stack?: string): Promise<DevelopmentSdkStatus>;
export interface DevelopmentSdkLaunchStatus {
  stack: string;
  stop: string | null;
  state: 'absent' | 'unconfirmed' | 'confirmed';
  reconcilable: boolean;
  reason?: string;
  transition: { id: string; phase: string; source: string } | null;
  observation: { status: string; reason?: string; apps?: Array<{ name: string; status: string; generation?: string }> };
}
export function inspectSdkLaunch(projectDirectory: string, stack: string): Promise<DevelopmentSdkLaunchStatus>;
export function reconcileSdkLaunch(projectDirectory: string, stack: string): Promise<{
  state: 'confirmed'; stop: string; stack: string; confirmed: string[]; inactive: string[]; optedOut: string[]; unaffected: string[];
}>;
export interface DevelopmentSdkAdoption {
  digest: string;
  plan: { protocol: 1; root: string; source: string; stack: string;
    workspaces: import('./sdk-operation.js').SdkWorkspaceIdentity[];
    transition: { id: string; source: string; journalSha256: string; proofSha256: string };
    startAttemptsSha256: string | null; profileSha256: string; checkpointSha256: string; buildSha256: string };
  launch: 'unconfirmed';
}
export function inspectSdkAdoption(projectDirectory: string, stack: string): Promise<DevelopmentSdkAdoption>;
export function adoptSdk(projectDirectory: string, stack: string, review: string): Promise<{
  state: 'current-files-adopted'; digest: string; source: string; stack: string; launch: 'unconfirmed'; history: string;
}>;
export function watchSdk(profile: DevelopmentSdkProfile, stack: string | undefined, signal: AbortSignal): Promise<void>;
