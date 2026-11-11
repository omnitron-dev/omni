export interface DevelopmentSdkStatus {
  mode: 'development' | 'registry';
  verifiedImports: number;
  source?: string;
  distributionLockChanged?: boolean;
}
export interface DevelopmentSdkProfile {
  schema: 1;
  root: string;
  source: string;
  links: Record<string, string>;
}
export function sdkCommand(args: string[]): Promise<void>;
export function inspectSdk(projectDirectory?: string): Promise<DevelopmentSdkStatus>;
export function watchSdk(profile: DevelopmentSdkProfile, stack: string | undefined, signal: AbortSignal): Promise<void>;
