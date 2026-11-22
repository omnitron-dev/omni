import type { IServiceOverride, IServiceRequirement, Provisioning } from '../../infrastructure/types.js';

export interface HostInspectionRequest {
  /** The services the stack declares — as a deployment would send them. */
  services: Record<string, IServiceRequirement>;
  /** The stack's overrides, their references resolved by the master. */
  overrides?: Record<string, IServiceOverride> | undefined;
  /** Units to read beyond the declared ones — one a person wrote, say. */
  units?: string[] | undefined;
  /** Paths to measure: exists, owner, size, the room on their filesystem. */
  paths?: string[] | undefined;
  /** Snap packages: installed, and which version. */
  snaps?: string[] | undefined;
  /** `key=value` files and the keys wanted from each; a key naming a credential is refused. */
  configKeys?: Array<{ path: string; keys: string[] }> | undefined;
}

export type FileState = 'absent' | 'matches' | 'differs' | 'not-managed' | 'not-declared' | 'unreadable' | 'verified-private';

export interface DiskReading {
  mount: string;
  sizeBytes: number;
  availBytes: number;
}

export interface UnitReading {
  unit: string;
  known: boolean;
  active: boolean;
  enabled: boolean;
  /** Detailed state reported by systemd, including activation and failure. */
  state: string;
  /** `Result`: `success`, or how it last ended — `exit-code`, `timeout`, `signal`… */
  result: string;
  mainPid: number | null;
  restarts: number | null;
  /** When it last entered `active`. */
  since: string | null;
  /** Its cgroup, which every process it runs is inside. */
  cgroup: string | null;
  fragmentPath: string | null;
  /** The command line, with the value after any `password=`, `login=` or `auth=` struck out. */
  execStart: string | null;
  /** Jobs systemd has pending — this unit's, and those it waits on — as `systemctl list-jobs` prints them. */
  jobs: string[];
  /** Its last journal lines, with every credential struck out as a command line's is. */
  journal: string[];
  /** Processes running its program, and whether each is inside it. */
  processes: Array<{ pid: number; cgroup: string | null; inUnit: boolean }>;
}

export interface ProbeReading {
  method: string;
  ok: boolean;
  /** The answer's scalar fields: height, target height, synchronized, version. */
  result?: Record<string, string | number | boolean>;
  /** The fields its declaration reads the answer by (`healthCheck.jsonrpc.report`). */
  report?: string[];
  error?: string;
}

export interface AptPackageReading {
  name: string;
  installed: string | null;
  candidate: string | null;
  state: 'current' | 'install' | 'upgrade' | 'blocked';
  detail: string;
}

export interface HostServiceReading {
  name: string;
  provisioning: Provisioning;
  networkMode?: string | undefined;
  /** An `external` service: its declared address, as this node sees it. */
  external?: {
    host: string;
    port: number | null;
    /** The address is one of this node's own, or loopback. */
    local: boolean;
    reachable: boolean;
    probe?: ProbeReading | undefined;
  };
  /** A `bareMetal` service: what is there, and what a deployment would do. */
  onHost?: {
    installed: boolean;
    packages?: AptPackageReading[];
    userExists: boolean;
    dataDir: { path: string; exists: boolean; owner: string | null; disk: DiskReading | null } | null;
    /** `active` is the plan's bit — up, or on its way; `state` is systemd's words for it. */
    unit: { name: string; known: boolean; active: boolean; enabled: boolean; state: string } | null;
    config: FileState;
    unitFile: FileState;
    actions: string[];
    refusals: string[];
    /** Its declared health check, asked on loopback — where its applications reach it. */
    probe?: ProbeReading | undefined;
  };
}

export interface HostInspection {
  interfaces: Array<{ name: string; address: string; family: string; internal: boolean }>;
  /** The machine's memory as its kernel counts it; null where there is no `/proc/meminfo`. */
  memory: MemoryReading | null;
  services: HostServiceReading[];
  units: UnitReading[];
  paths: Array<{
    path: string;
    exists: boolean;
    owner: string | null;
    sizeBytes: number | null;
    disk: DiskReading | null;
  }>;
  snaps: Array<{ name: string; installed: boolean; version: string | null; revision: string | null }>;
  configKeys: Array<{ path: string; exists: boolean | null; values: Record<string, string | null>; refused: string[] }>;
}

export interface MemoryReading {
  totalBytes: number;
  /** `MemAvailable`: what can be taken without swapping, reclaimable cache counted in — the kernel's estimate. */
  availableBytes: number;
  swapTotalBytes: number;
  swapFreeBytes: number;
}
