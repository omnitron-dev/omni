export interface TargetRuntime {
  platform: string;
  arch: string;
  node: string;
  abi: string;
  /** Bind the executable as well as its reported version. */
  executableSha256: string;
  libc: string | null;
}

export declare function targetRuntime(): Promise<TargetRuntime>;
