/**
 * System info DTOs — wire shapes shared with the Omnitron Console.
 *
 * Declared away from the service implementation for the reason set out in
 * `./auth.ts`: a DTO that imports from an implementation drags decorators and
 * the server's dependency graph into the console's build.
 */

import type { DaemonRole } from '../../config/types.js';

/** The parts of a snapshot that are asked separately, each with its own budget. */
export type SnapshotSection = 'os' | 'cpu' | 'memory' | 'disks' | 'network' | 'docker';

export interface SystemSnapshot {
  /** When it was collected. A snapshot is served while the next is collected: read its age from this. */
  timestamp: number;
  /** How long collecting it took. */
  collectedMs: number;
  /**
   * The sections that did not answer, and why. Their fields hold no reading —
   * zeros, empty lists, `null` — and must not be shown as one: `docker: null`
   * with a reason here is not «no Docker».
   */
  unanswered: Partial<Record<SnapshotSection, string>>;

  os: {
    platform: string;
    distro: string;
    release: string;
    kernel: string;
    arch: string;
    hostname: string;
    uptime: number;
  };

  cpu: {
    manufacturer: string;
    brand: string;
    cores: number;
    physicalCores: number;
    speed: number;
    currentLoad: number;
    loadPerCore: number[];
    temperature: number | null;
  };

  memory: {
    total: number;
    used: number;
    free: number;
    available: number;
    /** Memory genuinely spoken for: total minus available. Prefer this over
     * `used`, which counts reclaimable cache on macOS and Linux. */
    committed: number;
    usedPercent: number;
    swapTotal: number;
    swapUsed: number;
  };

  disks: Array<{
    fs: string;
    type: string;
    size: number;
    used: number;
    available: number;
    usedPercent: number;
    mount: string;
  }>;

  network: {
    interfaces: Array<{
      iface: string;
      ip4: string;
      ip6: string;
      mac: string;
      speed: number | null;
      operstate: string;
    }>;
    rxSec: number;
    txSec: number;
  };

  docker: {
    running: number;
    paused: number;
    stopped: number;
  } | null;

  daemon: {
    role: DaemonRole;
    pid: number;
    nodeVersion: string;
    v8Version: string;
    uptimeMs: number;
    memoryUsage: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      external: number;
    };
  };
}
