/**
 * Health DTOs — wire shapes shared with the Omnitron Console.
 *
 * Declared away from the service implementation for the reason set out in
 * `./auth.ts`: a DTO that imports from an implementation drags decorators and
 * the server's dependency graph into the console's build.
 */

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
