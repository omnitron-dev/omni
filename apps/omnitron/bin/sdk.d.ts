export interface DevelopmentSdkStatus {
  mode: 'development' | 'registry';
  verifiedImports: number;
  source?: string;
  distributionLock?: 'present' | 'absent' | 'manager-only';
  distributionLockChanged?: boolean;
  transition?: { id: string; phase: 'committed' | 'restored'; source: string };
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
export function watchSdk(profile: DevelopmentSdkProfile, stack: string | undefined, signal: AbortSignal): Promise<void>;
