/**
 * SystemInfoService — Real-time system metrics via systeminformation
 *
 * Collects OS, CPU, memory, disk, network, and Docker data.
 * Exposed via OmnitronSystemInfo RPC for webapp /system page.
 *
 * Three things this did, measured on the master 2026-09-23:
 *
 *   - It asked every section together and waited for the slowest. Docker,
 *     asked through systeminformation's socket client, never answered on this
 *     host (OrbStack keeps the HTTP/1.0 connection open; the library waits for
 *     it to close), so every snapshot waited its full 5-second timeout and the
 *     console's /system page drew placeholders for those five seconds.
 *   - The timeout did not end the question. Each snapshot opened another
 *     socket to Docker and left it hanging until the library's own timeout.
 *   - A 3-second cache under a 5-second poll: almost every poll was cold.
 *
 * Now each section is asked on its own, with a budget; a section that does
 * not answer in it is named in `unanswered` rather than read as empty; a
 * question still out is not asked again — a hung section costs one question,
 * not one per snapshot; Docker is asked the way the rest of the daemon asks
 * it (`countContainersByState`, the CLI with a timeout that ends it); and
 * after the first snapshot the answer is the last one collected, with its
 * age, while the next is collected behind it.
 */

import si from 'systeminformation';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { DaemonRole } from '../config/types.js';
import type { SnapshotSection, SystemSnapshot } from '../shared/dto/system-info.js';

// =============================================================================
// Types
// =============================================================================

export type { SystemSnapshot } from '../shared/dto/system-info.js';

// =============================================================================
// Service
// =============================================================================

/**
 * How long a section may take before the snapshot goes without it. All six
 * are asked at once and their subprocesses compete: a cold collection took
 * 1571-1889 ms on the master at load average 43-98 (2026-09-23), and at a
 * 2-second budget the CPU section missed it on the first snapshot.
 */
const SECTION_BUDGET_MS = 3_000;
/** A snapshot older than this is replaced behind the one being served. */
const REFRESH_AFTER_MS = 2_000;

type Answer<T> = { ok: true; value: T } | { ok: false; why: string };

/**
 * One section's question, never asked twice at once.
 *
 * A question that outlives its budget is left to finish — nothing here can
 * cancel a systeminformation call — and the next snapshot waits on THAT one
 * rather than asking again. So a section that hangs costs one question, and
 * says for how long it has been out.
 */
class SectionQuestion<T> {
  private pending: Promise<T> | null = null;
  private askedAt = 0;

  constructor(private readonly read: () => Promise<T>) {}

  async ask(budgetMs: number): Promise<Answer<T>> {
    if (!this.pending) {
      this.askedAt = Date.now();
      const question = this.read();
      this.pending = question;
      // Settled or not, a question that is over frees the slot; the rejection
      // is answered below, or by whichever snapshot is waiting on it.
      question.then(
        () => this.release(question),
        () => this.release(question),
      );
    }
    const question = this.pending;
    let timer: NodeJS.Timeout | undefined;
    const outOfTime = new Promise<'out-of-time'>((resolve) => {
      timer = setTimeout(() => resolve('out-of-time'), budgetMs);
    });
    try {
      const value = await Promise.race([question, outOfTime]);
      if (value === 'out-of-time') {
        const outFor = Math.round((Date.now() - this.askedAt) / 100) / 10;
        return { ok: false, why: `did not answer within ${budgetMs} ms (asked ${outFor} s ago, still out)` };
      }
      return { ok: true, value };
    } catch (err) {
      return { ok: false, why: (err as Error).message };
    } finally {
      clearTimeout(timer);
    }
  }

  private release(question: Promise<T>): void {
    if (this.pending === question) this.pending = null;
  }
}

/** What each section reads. Replaceable so a court can make one hang. */
export interface SectionReaders {
  os: () => Promise<{ info: si.Systeminformation.OsData; uptime: number }>;
  cpu: () => Promise<{
    info: si.Systeminformation.CpuData;
    load: si.Systeminformation.CurrentLoadData;
    temperature: si.Systeminformation.CpuTemperatureData | null;
  }>;
  memory: () => Promise<si.Systeminformation.MemData>;
  disks: () => Promise<si.Systeminformation.FsSizeData[]>;
  network: () => Promise<{
    interfaces: si.Systeminformation.NetworkInterfacesData[];
    stats: si.Systeminformation.NetworkStatsData[];
  }>;
  docker: () => Promise<{ running: number; paused: number; stopped: number }>;
}

const DEFAULT_READERS: SectionReaders = {
  os: async () => ({ info: await si.osInfo(), uptime: si.time().uptime }),
  cpu: async () => {
    const [info, load, temperature] = await Promise.all([
      si.cpu(),
      si.currentLoad(),
      si.cpuTemperature().catch(() => null),
    ]);
    return { info, load, temperature };
  },
  memory: () => si.mem(),
  disks: () => si.fsSize(),
  network: async () => {
    const [interfaces, stats] = await Promise.all([si.networkInterfaces(), si.networkStats()]);
    return { interfaces: Array.isArray(interfaces) ? interfaces : [interfaces], stats };
  },
  docker: async () => {
    const { countContainersByState } = await import('../infrastructure/container-runtime.js');
    return countContainersByState();
  },
};

export interface SystemInfoOptions {
  /** Replace a section's reader — how a court makes one hang. */
  readers?: Partial<SectionReaders>;
  budgetMs?: number;
  refreshAfterMs?: number;
}

export class SystemInfoService {
  private last: SystemSnapshot | null = null;
  private collecting: Promise<SystemSnapshot> | null = null;
  private readonly questions: { [K in SnapshotSection]: SectionQuestion<Awaited<ReturnType<SectionReaders[K]>>> };
  private readonly budgetMs: number;
  private readonly refreshAfterMs: number;

  constructor(
    private readonly logger: ILogger,
    private readonly role: DaemonRole,
    options: SystemInfoOptions = {},
  ) {
    this.budgetMs = options.budgetMs ?? SECTION_BUDGET_MS;
    this.refreshAfterMs = options.refreshAfterMs ?? REFRESH_AFTER_MS;
    const read = { ...DEFAULT_READERS, ...options.readers };
    this.questions = {
      os: new SectionQuestion(read.os),
      cpu: new SectionQuestion(read.cpu),
      memory: new SectionQuestion(read.memory),
      disks: new SectionQuestion(read.disks),
      network: new SectionQuestion(read.network),
      docker: new SectionQuestion(read.docker),
    };
  }

  /**
   * The last snapshot, and a newer one on its way when it has aged. Only the
   * very first call waits — for at most one section budget.
   */
  async getSnapshot(): Promise<SystemSnapshot> {
    if (!this.last) return this.collect();
    if (Date.now() - this.last.timestamp >= this.refreshAfterMs) void this.collect().catch(() => undefined);
    return this.last;
  }

  private collect(): Promise<SystemSnapshot> {
    this.collecting ??= this.collectOnce().finally(() => {
      this.collecting = null;
    });
    return this.collecting;
  }

  private async collectOnce(): Promise<SystemSnapshot> {
    const started = Date.now();
    const budget = this.budgetMs;
    const [os, cpu, memory, disks, network, docker] = await Promise.all([
      this.questions.os.ask(budget),
      this.questions.cpu.ask(budget),
      this.questions.memory.ask(budget),
      this.questions.disks.ask(budget),
      this.questions.network.ask(budget),
      this.questions.docker.ask(budget),
    ]);

    const unanswered: SystemSnapshot['unanswered'] = {};
    const value = <T>(section: SnapshotSection, answer: Answer<T>): T | null => {
      if (answer.ok) return answer.value;
      unanswered[section] = answer.why;
      return null;
    };
    const osData = value('os', os);
    const cpuData = value('cpu', cpu);
    const mem = value('memory', memory);
    const diskData = value('disks', disks) ?? [];
    const net = value('network', network);
    const dockerData = value('docker', docker);
    if (Object.keys(unanswered).length > 0) {
      this.logger.debug({ unanswered }, 'System snapshot collected without some sections');
    }

    const memUsage = process.memoryUsage();
    const snapshot: SystemSnapshot = {
      timestamp: Date.now(),
      collectedMs: Date.now() - started,
      unanswered,

      os: {
        platform: osData?.info.platform ?? process.platform,
        distro: osData?.info.distro ?? '',
        release: osData?.info.release ?? '',
        kernel: osData?.info.kernel ?? '',
        arch: osData?.info.arch ?? process.arch,
        hostname: osData?.info.hostname ?? '',
        uptime: osData?.uptime ?? 0,
      },

      cpu: {
        manufacturer: cpuData?.info.manufacturer ?? '',
        brand: cpuData?.info.brand ?? '',
        cores: cpuData?.info.cores ?? 0,
        physicalCores: cpuData?.info.physicalCores ?? 0,
        speed: cpuData?.info.speed ?? 0,
        currentLoad: cpuData?.load.currentLoad ?? 0,
        loadPerCore: (cpuData?.load.cpus ?? []).map((c) => c.load),
        temperature: cpuData?.temperature?.main ?? null,
      },

      memory: {
        total: mem?.total ?? 0,
        // `systeminformation`'s `used` is `total - free`, and on macOS and
        // Linux `free` excludes everything the kernel is holding as cache
        // — reclaimable the moment a process asks. So `used` sat at 97.8%
        // on this host while `available` on the same card read 31.9 GB:
        // two numbers side by side that cannot both be a useful reading.
        //
        // `used` and `free` are still reported as the library gives them,
        // because they are what those words mean to the tools an operator
        // compares against. `committed` is the one to render: memory that
        // is genuinely spoken for, and it agrees with `available`.
        used: mem?.used ?? 0,
        free: mem?.free ?? 0,
        available: mem?.available ?? 0,
        committed: mem ? Math.max(0, mem.total - (mem.available ?? mem.free ?? 0)) : 0,
        usedPercent:
          mem && mem.total > 0 ? (Math.max(0, mem.total - (mem.available ?? mem.free ?? 0)) / mem.total) * 100 : 0,
        swapTotal: mem?.swaptotal ?? 0,
        swapUsed: mem?.swapused ?? 0,
      },

      disks: diskData
        .filter((d) => d.size > 0)
        .map((d) => ({
          fs: d.fs,
          type: d.type,
          size: d.size,
          used: d.used,
          available: d.available,
          usedPercent: d.use,
          mount: d.mount,
        })),

      network: {
        interfaces: (net?.interfaces ?? [])
          .filter((i) => !i.internal)
          .map((i) => ({
            iface: i.iface,
            ip4: i.ip4,
            ip6: i.ip6,
            mac: i.mac,
            speed: i.speed,
            operstate: i.operstate,
          })),
        rxSec: (net?.stats ?? []).reduce((sum, s) => sum + (s.rx_sec ?? 0), 0),
        txSec: (net?.stats ?? []).reduce((sum, s) => sum + (s.tx_sec ?? 0), 0),
      },

      docker: dockerData,

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

    this.last = snapshot;
    return snapshot;
  }
}
