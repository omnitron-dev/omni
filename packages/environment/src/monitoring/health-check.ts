/**
 * Health Check System
 * Monitors system health and readiness
 */

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  message?: string;
  timestamp: number;
  duration: number;
  metadata?: Record<string, unknown>;
}

export interface HealthCheck {
  name: string;
  check: () => Promise<HealthCheckResult>;
  timeout?: number;
  critical?: boolean;
}

export interface HealthReport {
  status: HealthStatus;
  checks: HealthCheckResult[];
  timestamp: number;
  uptime: number;
}

export class HealthCheckManager {
  private checks: Map<string, HealthCheck>;
  private startTime: number;
  private lastResults: Map<string, HealthCheckResult>;

  constructor() {
    this.checks = new Map();
    this.startTime = Date.now();
    this.lastResults = new Map();
  }

  /**
   * Register a health check
   */
  registerCheck(check: HealthCheck): void {
    this.checks.set(check.name, check);
  }

  /**
   * Unregister a health check
   */
  unregisterCheck(name: string): boolean {
    this.lastResults.delete(name);
    return this.checks.delete(name);
  }

  /**
   * Run all health checks
   */
  async runChecks(): Promise<HealthReport> {
    const checks = Array.from(this.checks.values());
    const results: HealthCheckResult[] = [];

    await Promise.all(
      checks.map(async (check) => {
        const result = await this.runCheck(check);
        results.push(result);
        this.lastResults.set(check.name, result);
      })
    );

    // Determine overall status
    const status = this.determineOverallStatus(results);

    return {
      status,
      checks: results,
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
    };
  }

  /**
   * Run a single health check
   */
  async runCheck(check: HealthCheck): Promise<HealthCheckResult> {
    const start = Date.now();
    const timeout = check.timeout ?? 5000;

    try {
      const timeoutPromise = new Promise<HealthCheckResult>((_, reject) => {
        setTimeout(() => reject(new Error('Health check timeout')), timeout);
      });

      const result = await Promise.race([check.check(), timeoutPromise]);
      const duration = Date.now() - start;

      return {
        ...result,
        duration,
      };
    } catch (error) {
      return {
        name: check.name,
        status: 'unhealthy',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
        duration: Date.now() - start,
      };
    }
  }

  /**
   * Get last check result
   */
  getLastResult(name: string): HealthCheckResult | undefined {
    return this.lastResults.get(name);
  }

  /**
   * Get all last results
   */
  getAllLastResults(): HealthCheckResult[] {
    return Array.from(this.lastResults.values());
  }

  /**
   * Get quick health status
   */
  async getQuickHealth(): Promise<{
    status: HealthStatus;
    timestamp: number;
    uptime: number;
  }> {
    const lastResults = this.getAllLastResults();

    if (lastResults.length === 0) {
      // No checks registered, assume healthy
      return {
        status: 'healthy',
        timestamp: Date.now(),
        uptime: Date.now() - this.startTime,
      };
    }

    const status = this.determineOverallStatus(lastResults);

    return {
      status,
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
    };
  }

  /**
   * Check if system is ready
   */
  async isReady(): Promise<boolean> {
    const report = await this.runChecks();
    return report.status === 'healthy';
  }

  /**
   * Check if system is alive
   */
  isAlive(): boolean {
    return true; // If we can respond, we're alive
  }

  /**
   * Clear all checks
   */
  clear(): void {
    this.checks.clear();
    this.lastResults.clear();
  }

  /**
   * Get uptime in milliseconds
   */
  getUptime(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Reset uptime counter
   */
  resetUptime(): void {
    this.startTime = Date.now();
  }

  private determineOverallStatus(results: HealthCheckResult[]): HealthStatus {
    if (results.length === 0) {
      return 'healthy';
    }

    const criticalChecks = Array.from(this.checks.values()).filter((c) => c.critical);
    const criticalNames = new Set(criticalChecks.map((c) => c.name));

    // Check critical checks first
    for (const result of results) {
      if (criticalNames.has(result.name) && result.status === 'unhealthy') {
        return 'unhealthy';
      }
    }

    // Check for any unhealthy
    const hasUnhealthy = results.some((r) => r.status === 'unhealthy');
    if (hasUnhealthy) {
      return 'degraded';
    }

    // Check for degraded
    const hasDegraded = results.some((r) => r.status === 'degraded');
    if (hasDegraded) {
      return 'degraded';
    }

    return 'healthy';
  }
}
