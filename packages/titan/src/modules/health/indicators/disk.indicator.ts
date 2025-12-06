/**
 * Disk Health Indicator
 *
 * Monitors disk space usage and reports health status based on thresholds.
 *
 * @module titan/modules/health/indicators
 */

import { HealthIndicator } from '../health.indicator.js';
import type { HealthIndicatorResult, DiskThresholds } from '../health.types.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
import { Errors } from '../../../errors/index.js';

/**
 * Default disk thresholds
 */
const DEFAULT_THRESHOLDS: Required<DiskThresholds> = {
  usageDegradedThreshold: 0.8,
  usageUnhealthyThreshold: 0.95,
  path: '/',
};

/**
 * Disk usage information
 */
interface DiskInfo {
  total: number;
  used: number;
  available: number;
  usedPercent: number;
  filesystem: string;
  mountpoint: string;
}

/**
 * Disk Health Indicator
 *
 * Monitors disk space and reports health based on configurable thresholds.
 * Works on Unix-like systems (Linux, macOS) and Windows.
 *
 * @example
 * ```typescript
 * const diskIndicator = new DiskHealthIndicator({
 *   path: '/',
 *   usageDegradedThreshold: 0.8,  // 80% usage triggers degraded
 *   usageUnhealthyThreshold: 0.95, // 95% usage triggers unhealthy
 * });
 *
 * const result = await diskIndicator.check();
 * // Returns health status based on disk usage
 * ```
 */
export class DiskHealthIndicator extends HealthIndicator {
  readonly name = 'disk';
  private thresholds: Required<DiskThresholds>;

  constructor(thresholds: DiskThresholds = {}) {
    super();
    this.thresholds = {
      usageDegradedThreshold: thresholds.usageDegradedThreshold ?? DEFAULT_THRESHOLDS.usageDegradedThreshold,
      usageUnhealthyThreshold: thresholds.usageUnhealthyThreshold ?? DEFAULT_THRESHOLDS.usageUnhealthyThreshold,
      path: thresholds.path ?? DEFAULT_THRESHOLDS.path,
    };
  }

  /**
   * Perform the disk health check
   */
  async check(): Promise<HealthIndicatorResult> {
    const start = Date.now();

    try {
      const diskInfo = await this.getDiskInfo();
      const latency = Date.now() - start;

      const details = {
        path: this.thresholds.path,
        filesystem: diskInfo.filesystem,
        mountpoint: diskInfo.mountpoint,
        total: this.formatBytes(diskInfo.total),
        used: this.formatBytes(diskInfo.used),
        available: this.formatBytes(diskInfo.available),
        usedPercent: (diskInfo.usedPercent * 100).toFixed(1) + '%',
        thresholds: {
          degraded: (this.thresholds.usageDegradedThreshold * 100).toFixed(0) + '%',
          unhealthy: (this.thresholds.usageUnhealthyThreshold * 100).toFixed(0) + '%',
        },
      };

      if (diskInfo.usedPercent >= this.thresholds.usageUnhealthyThreshold) {
        return {
          ...this.unhealthy(
            'Disk usage (' + (diskInfo.usedPercent * 100).toFixed(1) + '%) exceeds unhealthy threshold',
            details
          ),
          latency,
        };
      }

      if (diskInfo.usedPercent >= this.thresholds.usageDegradedThreshold) {
        return {
          ...this.degraded(
            'Disk usage (' + (diskInfo.usedPercent * 100).toFixed(1) + '%) exceeds degraded threshold',
            details
          ),
          latency,
        };
      }

      return {
        ...this.healthy(
          'Disk usage is within normal limits (' + (diskInfo.usedPercent * 100).toFixed(1) + '%)',
          details
        ),
        latency,
      };
    } catch (error) {
      const latency = Date.now() - start;
      return {
        ...this.unhealthy(
          'Failed to check disk status',
          { path: this.thresholds.path, error: (error as Error).message }
        ),
        latency,
      };
    }
  }

  /**
   * Get disk information for the configured path
   */
  private async getDiskInfo(): Promise<DiskInfo> {
    if (process.platform === 'win32') {
      return this.getDiskInfoWindows();
    }
    return this.getDiskInfoUnix();
  }

  /**
   * Get disk info on Unix-like systems
   */
  private async getDiskInfoUnix(): Promise<DiskInfo> {
    const { stdout } = await execAsync('df -P ' + this.thresholds.path);
    const lines = stdout.trim().split('\n');

    if (lines.length < 2) {
      throw Errors.internal('Unable to parse df output');
    }

    // Parse the second line (first is header)
    const dataLine = lines[1];
    if (!dataLine) {
      throw Errors.internal('No data line in df output');
    }

    const parts = dataLine.split(/\s+/);

    if (parts.length < 6) {
      throw Errors.internal('Invalid df output format');
    }

    const filesystem = parts[0] ?? 'unknown';
    const totalStr = parts[1] ?? '0';
    const usedStr = parts[2] ?? '0';
    const availableStr = parts[3] ?? '0';
    const mountpoint = parts[5] ?? '/';

    const total = parseInt(totalStr, 10) * 1024; // df reports in 1K blocks
    const used = parseInt(usedStr, 10) * 1024;
    const available = parseInt(availableStr, 10) * 1024;

    return {
      filesystem,
      total,
      used,
      available,
      usedPercent: total > 0 ? used / total : 0,
      mountpoint,
    };
  }

  /**
   * Get disk info on Windows
   */
  private async getDiskInfoWindows(): Promise<DiskInfo> {
    // Extract drive letter from path (e.g., "C:" from "C:\Users")
    const driveLetter = this.thresholds.path.charAt(0).toUpperCase();
    const { stdout } = await execAsync(
      'wmic logicaldisk where "DeviceID=\'' + driveLetter + ':\'" get FreeSpace,Size /format:csv'
    );

    const lines = stdout.trim().split('\n').filter(line => line.trim());

    if (lines.length < 2) {
      throw Errors.internal('Unable to parse wmic output');
    }

    // Parse CSV output (skip header)
    const dataLine = lines[1];
    if (!dataLine) {
      throw Errors.internal('No data line in wmic output');
    }

    const parts = dataLine.split(',');

    if (parts.length < 3) {
      throw Errors.internal('Invalid wmic output format');
    }

    const freeSpaceStr = parts[1] ?? '0';
    const totalStr = parts[2] ?? '0';

    const available = parseInt(freeSpaceStr, 10);
    const total = parseInt(totalStr, 10);
    const used = total - available;

    return {
      filesystem: driveLetter + ':',
      total,
      used,
      available,
      usedPercent: total > 0 ? used / total : 0,
      mountpoint: driveLetter + ':\\',
    };
  }

  /**
   * Format bytes to human-readable string
   */
  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let unitIndex = 0;
    let size = bytes;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return size.toFixed(2) + ' ' + units[unitIndex];
  }

  /**
   * Get the current thresholds
   */
  getThresholds(): Required<DiskThresholds> {
    return { ...this.thresholds };
  }

  /**
   * Update the thresholds
   */
  setThresholds(thresholds: Partial<DiskThresholds>): void {
    this.thresholds = {
      ...this.thresholds,
      ...thresholds,
    };
  }

  /**
   * Set the path to check
   */
  setPath(path: string): void {
    this.thresholds.path = path;
  }
}
