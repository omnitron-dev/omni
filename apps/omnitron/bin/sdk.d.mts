export interface DevelopmentSdkStatus {
  mode: 'development' | 'registry';
  verifiedImports: number;
  source?: string;
  distributionLockChanged?: boolean;
}
export function sdkCommand(args: string[]): Promise<void>;
export function inspectSdk(projectDirectory?: string): Promise<DevelopmentSdkStatus>;
