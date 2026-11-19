export interface SdkWorkspaceIdentity { root: string; device: string; inode: string }
export interface MigrationSdkReference {
  id: string;
  review: string;
  journal: string;
  read(): { id: string; kind: string; inputDigest: string; state: string } | null |
    Promise<{ id: string; kind: string; inputDigest: string; state: string } | null>;
}
export interface MigrationSdkHold { retain(): Promise<void>; release(): Promise<void> }
export function sdkStatePath(root: string): string;
export function prepareSdkState(root: string): Promise<string>;
export function sdkWorkspaceIdentity(root: string): Promise<SdkWorkspaceIdentity>;
export function sdkReuseWorkspaceIdentity(root: string): Promise<SdkWorkspaceIdentity>;
export function exclusively<T>(directory: string, body: () => Promise<T>, signal?: AbortSignal, existing?: boolean): Promise<T>;
export function assertSdkAvailable(root: string, ownedSelection?: { root: string; id: string }): Promise<void>;
export function clearSdkSelection(root: string, source: string, id: string): Promise<void>;
export function withMigrationSdkLocks<T>(workspaces: readonly SdkWorkspaceIdentity[], reference: MigrationSdkReference,
  body: (hold: MigrationSdkHold) => Promise<T>): Promise<T>;
export function releaseTerminalMigrationSdk(workspaces: readonly SdkWorkspaceIdentity[], reference: MigrationSdkReference): Promise<void>;
