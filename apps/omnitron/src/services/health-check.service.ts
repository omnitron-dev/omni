/**
 * HealthCheckService — Composable health checks using @xec-sh/ops HealthChecker
 *
 * Provides detailed, composable health checks for:
 * - Individual apps (HTTP health endpoint + process liveness)
 * - Infrastructure services (TCP port connectivity)
 * - Full platform (apps + infra combined)
 *
 * Uses dynamic import for @xec-sh/ops — falls back to basic TCP/HTTP checks
 * when the package is not installed.
 */

import type { OrchestratorService } from '../orchestrator/orchestrator.service.js';
import type { InfrastructureService } from '../infrastructure/infrastructure.service.js';

// =============================================================================
// Types
// =============================================================================

export interface HealthCheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message?: string | undefined;
  duration?: number | undefined;
}

export interface HealthReport {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  checks: HealthCheckResult[];
  timestamp: string;
  duration: number;
}

export interface PlatformHealthReport {
  apps: HealthReport;
  infra: HealthReport;
  overall: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
}

// =============================================================================
// @xec-sh/ops HealthChecker — loaded dynamically
// =============================================================================

import { loadXecOps } from '../shared/xec-loader.js';

type XecHealthReport = import('@xec-sh/ops').HealthReport;

// =============================================================================
// Fallback health checks (when @xec-sh/ops is not available)
// =============================================================================

async function checkTcp(host: string, port: number, timeout = 3000): Promise<HealthCheckResult> {
  const start = Date.now();
  const name = `tcp:${host}:${port}`;
  try {
    const net = await import('node:net');
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host, port }, () => {
        socket.destroy();
        resolve();
      });
      socket.setTimeout(timeout);
      socket.on('timeout', () => { socket.destroy(); reject(new Error('timeout')); });
      socket.on('error', reject);
    });
    return { name, status: 'pass', duration: Date.now() - start };
  } catch (err) {
    return { name, status: 'fail', message: (err as Error).message, duration: Date.now() - start };
  }
}

async function checkHttp(url: string, timeout = 5000): Promise<HealthCheckResult> {
  const start = Date.now();
  const parsed = new URL(url);
  const name = `http:${parsed.host}${parsed.pathname}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (response.ok) {
      return { name, status: 'pass', duration: Date.now() - start };
    }
    return { name, status: 'warn', message: `HTTP ${response.status}`, duration: Date.now() - start };
  } catch (err) {
    return { name, status: 'fail', message: (err as Error).message, duration: Date.now() - start };
  }
}

function aggregateStatus(checks: HealthCheckResult[]): 'healthy' | 'degraded' | 'unhealthy' {
  const hasFail = checks.some((c) => c.status === 'fail');
  const hasWarn = checks.some((c) => c.status === 'warn');
  if (hasFail) return 'unhealthy';
  if (hasWarn) return 'degraded';
  return 'healthy';
}

/**
 * Convert xec HealthReport to our HealthCheckResult array.
 */
function mapXecReport(report: XecHealthReport): HealthCheckResult[] {
  return report.checks.map((c) => ({
    name: c.name,
    status: c.healthy ? 'pass' as const : 'fail' as const,
    ...(c.message ? { message: c.message } : {}),
    ...(c.error ? { message: c.error } : {}),
    duration: c.duration,
  }));
}

// =============================================================================
// Service
// =============================================================================

export class HealthCheckService {
  constructor(
    private readonly orchestrator: OrchestratorService,
    private readonly getInfraService: () => InfrastructureService | null
  ) {}

  /**
   * Check health of a specific app using HTTP endpoint + process liveness.
   */
  async checkApp(appName: string, port?: number | null): Promise<HealthReport> {
    const start = Date.now();
    const xec = await loadXecOps();

    if (xec) {
      const hc = xec.HealthChecker.create();

      if (port) {
        hc.http(`http://localhost:${port}/health`, { timeout: 5000 });
      }

      hc.custom(`${appName}-process`, async () => {
        const info = this.orchestrator.getApp(appName);
        return info?.status === 'online';
      });

      const result = await hc.run();
      return {
        overall: result.healthy ? 'healthy' : 'unhealthy',
        checks: mapXecReport(result),
        timestamp: new Date().toISOString(),
        duration: Date.now() - start,
      };
    }

    // Fallback: basic checks without @xec-sh/ops
    const checks: HealthCheckResult[] = [];

    // Process liveness check
    const info = this.orchestrator.getApp(appName);
    checks.push({
      name: `${appName}-process`,
      status: info?.status === 'online' ? 'pass' : 'fail',
      message: info ? `status: ${info.status}` : 'app not found',
    });

    // HTTP health check (if port provided)
    if (port) {
      checks.push(await checkHttp(`http://localhost:${port}/health`));
    }

    return {
      overall: aggregateStatus(checks),
      checks,
      timestamp: new Date().toISOString(),
      duration: Date.now() - start,
    };
  }

  /**
   * Check health of all managed apps.
   */
  async checkApps(): Promise<HealthReport> {
    const start = Date.now();
    const apps = this.orchestrator.list();
    const allChecks: HealthCheckResult[] = [];

    for (const app of apps) {
      const handle = this.orchestrator.getHandle(app.name);
      const port = handle?.port;

      const appReport = await this.checkApp(app.name, port);
      allChecks.push(...appReport.checks);
    }

    return {
      overall: aggregateStatus(allChecks),
      checks: allChecks,
      timestamp: new Date().toISOString(),
      duration: Date.now() - start,
    };
  }

  /**
   * Check health of all infrastructure services.
   */
  async checkInfrastructure(): Promise<HealthReport> {
    const start = Date.now();
    const xec = await loadXecOps();
    const infra = this.getInfraService();

    if (xec) {
      const hc = xec.HealthChecker.create();

      // PostgreSQL (app)
      hc.tcp('localhost', 5432, { timeout: 3000 });
      // PostgreSQL (omnitron-pg)
      hc.tcp('localhost', 5480, { timeout: 3000 });
      // Redis
      hc.tcp('localhost', 6379, { timeout: 3000 });
      // MinIO
      hc.http('http://localhost:9000/minio/health/live', { timeout: 5000 });

      // Custom check: infra service state
      if (infra) {
        hc.custom('infra-reconciler', async () => {
          const state = infra.getState();
          return state.ready;
        });
      }

      const result = await hc.run();
      return {
        overall: result.healthy ? 'healthy' : 'unhealthy',
        checks: mapXecReport(result),
        timestamp: new Date().toISOString(),
        duration: Date.now() - start,
      };
    }

    // Fallback: basic TCP port checks
    const checks = await Promise.all([
      checkTcp('localhost', 5432, 3000),
      checkTcp('localhost', 5480, 3000),
      checkTcp('localhost', 6379, 3000),
      checkHttp('http://localhost:9000/minio/health/live', 5000),
    ]);

    // Rename for clarity
    checks[0]!.name = 'postgres';
    checks[1]!.name = 'omnitron-pg';
    checks[2]!.name = 'redis';
    checks[3]!.name = 'minio';

    // Add infra reconciler check
    if (infra) {
      const state = infra.getState();
      checks.push({
        name: 'infra-reconciler',
        status: state.ready ? 'pass' : 'fail',
        message: state.ready ? 'ready' : 'not ready',
      });
    }

    return {
      overall: aggregateStatus(checks),
      checks,
      timestamp: new Date().toISOString(),
      duration: Date.now() - start,
    };
  }

  /**
   * Full platform health check — apps + infrastructure.
   */
  async checkAll(): Promise<PlatformHealthReport> {
    const [apps, infra] = await Promise.all([
      this.checkApps(),
      this.checkInfrastructure(),
    ]);

    const overall: PlatformHealthReport['overall'] =
      apps.overall === 'unhealthy' || infra.overall === 'unhealthy'
        ? 'unhealthy'
        : apps.overall === 'degraded' || infra.overall === 'degraded'
          ? 'degraded'
          : 'healthy';

    return {
      apps,
      infra,
      overall,
      timestamp: new Date().toISOString(),
    };
  }
}

