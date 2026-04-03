/**
 * SystemInfoService — Real-time system metrics via systeminformation
 *
 * Collects OS, CPU, memory, disk, network, and Docker data.
 * Exposed via OmnitronSystemInfo RPC for webapp /system page.
 * Uses caching to avoid hammering the OS on every request.
 */

import si from 'systeminformation';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { DaemonRole } from '../config/types.js';

// =============================================================================
// Types
// =============================================================================

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

// =============================================================================
// Service
// =============================================================================

const CACHE_TTL = 3000; // 3s cache — prevents hammering on rapid requests
const COLLECT_TIMEOUT = 5000; // 5s max per si call — prevents hanging on Docker/network

/** Wrap a promise with a timeout — rejects if not settled within `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export class SystemInfoService {
  private cache: SystemSnapshot | null = null;
  private cacheTime = 0;
  private collecting = false;

  constructor(
    private readonly logger: ILogger,
    private readonly role: DaemonRole,
  ) {}

  async getSnapshot(): Promise<SystemSnapshot> {
    if (this.cache && Date.now() - this.cacheTime < CACHE_TTL) {
      return this.cache;
    }

    // Prevent concurrent collection
    if (this.collecting && this.cache) return this.cache;
    this.collecting = true;

    try {
      const t = COLLECT_TIMEOUT;
      const [osInfo, cpuInfo, cpuLoad, cpuTemp, mem, fsSize, netIfaces, netStats, dockerInfo] =
        await Promise.allSettled([
          withTimeout(si.osInfo(), t),
          withTimeout(si.cpu(), t),
          withTimeout(si.currentLoad(), t),
          withTimeout(si.cpuTemperature(), t),
          withTimeout(si.mem(), t),
          withTimeout(si.fsSize(), t),
          withTimeout(si.networkInterfaces(), t),
          withTimeout(si.networkStats(), t),
          withTimeout(si.dockerInfo(), t),
        ]);

      const os = osInfo.status === 'fulfilled' ? osInfo.value : null;
      const cpu = cpuInfo.status === 'fulfilled' ? cpuInfo.value : null;
      const load = cpuLoad.status === 'fulfilled' ? cpuLoad.value : null;
      const temp = cpuTemp.status === 'fulfilled' ? cpuTemp.value : null;
      const memory = mem.status === 'fulfilled' ? mem.value : null;
      const disks = fsSize.status === 'fulfilled' ? fsSize.value : [];
      const ifaces = netIfaces.status === 'fulfilled' ? netIfaces.value : [];
      const stats = netStats.status === 'fulfilled' ? netStats.value : [];
      const docker = dockerInfo.status === 'fulfilled' ? dockerInfo.value : null;

      const memUsage = process.memoryUsage();

      const snapshot: SystemSnapshot = {
        timestamp: Date.now(),

        os: {
          platform: os?.platform ?? process.platform,
          distro: os?.distro ?? '',
          release: os?.release ?? '',
          kernel: os?.kernel ?? '',
          arch: os?.arch ?? process.arch,
          hostname: os?.hostname ?? '',
          uptime: os ? si.time().uptime : 0,
        },

        cpu: {
          manufacturer: cpu?.manufacturer ?? '',
          brand: cpu?.brand ?? '',
          cores: cpu?.cores ?? 0,
          physicalCores: cpu?.physicalCores ?? 0,
          speed: cpu?.speed ?? 0,
          currentLoad: load?.currentLoad ?? 0,
          loadPerCore: (load?.cpus ?? []).map((c: any) => c.load),
          temperature: temp?.main ?? null,
        },

        memory: {
          total: memory?.total ?? 0,
          used: memory?.used ?? 0,
          free: memory?.free ?? 0,
          available: memory?.available ?? 0,
          usedPercent: memory ? (memory.used / memory.total) * 100 : 0,
          swapTotal: memory?.swaptotal ?? 0,
          swapUsed: memory?.swapused ?? 0,
        },

        disks: (Array.isArray(disks) ? disks : [])
          .filter((d: any) => d.size > 0)
          .map((d: any) => ({
            fs: d.fs,
            type: d.type,
            size: d.size,
            used: d.used,
            available: d.available,
            usedPercent: d.use,
            mount: d.mount,
          })),

        network: {
          interfaces: (Array.isArray(ifaces) ? ifaces : [])
            .filter((i: any) => !i.internal)
            .map((i: any) => ({
              iface: i.iface,
              ip4: i.ip4,
              ip6: i.ip6,
              mac: i.mac,
              speed: i.speed,
              operstate: i.operstate,
            })),
          rxSec: (Array.isArray(stats) ? stats : []).reduce((sum: number, s: any) => sum + (s.rx_sec ?? 0), 0),
          txSec: (Array.isArray(stats) ? stats : []).reduce((sum: number, s: any) => sum + (s.tx_sec ?? 0), 0),
        },

        docker: docker && typeof docker === 'object' && 'containers' in docker ? {
          running: (docker as any).containersRunning ?? 0,
          paused: (docker as any).containersPaused ?? 0,
          stopped: (docker as any).containersStopped ?? 0,
        } : null,

        daemon: {
          role: this.role,
          pid: process.pid,
          nodeVersion: process.version,
          v8Version: process.versions.v8,
          uptimeMs: process.uptime() * 1000,
          memoryUsage: {
            rss: memUsage.rss,
            heapTotal: memUsage.heapTotal,
            heapUsed: memUsage.heapUsed,
            external: memUsage.external,
          },
        },
      };

      this.cache = snapshot;
      this.cacheTime = Date.now();
      return snapshot;
    } catch (err) {
      this.logger.warn({ error: (err as Error).message }, 'Failed to collect system info');
      if (this.cache) return this.cache;
      throw err;
    } finally {
      this.collecting = false;
    }
  }
}
