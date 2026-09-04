/**
 * System info DTOs — wire shapes shared with the Omnitron Console.
 *
 * Declared away from the service implementation for the reason set out in
 * `./auth.ts`: a DTO that imports from an implementation drags decorators and
 * the server's dependency graph into the console's build.
 */

import type { DaemonRole } from '../../config/types.js';

export interface SystemSnapshot {
  timestamp: number;

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
