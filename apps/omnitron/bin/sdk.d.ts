export interface DevelopmentSdkStatus {
  mode: 'development' | 'registry';
  verifiedImports: number;
  source?: string;
  distributionLock?: 'present' | 'absent' | 'manager-only';
  distributionLockChanged?: boolean;
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
export function sdkCommand(args: string[]): Promise<void>;
export function inspectSdk(projectDirectory?: string, stack?: string): Promise<DevelopmentSdkStatus>;
export function watchSdk(profile: DevelopmentSdkProfile, stack: string | undefined, signal: AbortSignal): Promise<void>;
