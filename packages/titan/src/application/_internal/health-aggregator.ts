/**
 * Internal collaborator — health-check aggregation.
 *
 * Walks every registered module, runs its `health()` if it has one, and
 * folds the per-module results into an overall status (`healthy` →
 * `degraded` → `unhealthy`).
 *
 * Why a dedicated collaborator? The legacy `Application` had two health
 * methods (single-module and overall) that each handled error-from-
 * health-check separately. Centralising lets the "throw → unhealthy"
 * conversion live in one place.
 *
 * Single responsibility: turn module health results into an
 * `IHealthStatus` snapshot. Knows nothing about lifecycle, config, or
 * shutdown.
 *
 * @internal
 */

import { Errors } from '../../errors/index.js';
import type {
  IHealthStatus,
  IModule,
} from '../../types.js';

export interface HealthAggregatorContext {
  /** Resolve a module by name; throws `notFound` if missing. Matches `Application.getModule` behaviour. */
  getModule(name: string): IModule;
  /** Iterate every registered module. */
  modules(): Iterable<IModule>;
  /** Snapshot data for the top-level overall status. */
  readonly appName: string;
  readonly appVersion: string;
  readonly state: string;
  readonly uptime: number;
  readonly isStarted: boolean;
}

export class HealthAggregator {
  constructor(private readonly ctx: HealthAggregatorContext) {}

  /**
   * Check a single module by name. Returns one of three shapes:
   *
   *  - `unhealthy` with a "not found" message when the module doesn't exist
   *  - `healthy` with a `started` flag when the module has no `health()`
   *  - The module's own status, or `unhealthy` if it threw
   *
   * The "not found" path swallows the underlying `Errors.notFound` so
   * external probes can call this with arbitrary names without 404
   * exceptions leaking into request handlers.
   */
  async checkModule(moduleName: string): Promise<IHealthStatus> {
    // The legacy `Application.checkHealth` called `this.getModule(name)`
    // WITHOUT a try/catch, so a missing module surfaced the
    // `Errors.notFound` exception to the caller. Tests assert on
    // `rejects.toThrow` for non-existent modules — preserve that
    // contract by letting the not-found error escape.
    const module = this.ctx.getModule(moduleName);

    if (!module.health) {
      return {
        status: 'healthy',
        message: `Module ${moduleName} does not have health check`,
        details: { started: this.ctx.isStarted },
      };
    }

    try {
      return await module.health();
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Health check failed for module ${moduleName}`,
        details: { error: error instanceof Error ? error.message : 'Unknown error' },
      };
    }
  }

  /**
   * Aggregate every module's health. Overall status is the WORST per-
   * module status seen, with `unhealthy` being terminal. Modules without
   * a `health()` method are silently skipped — the legacy implementation
   * also skipped them (no entry in the modules map), so this preserves
   * that contract.
   *
   * Note: the returned object exposes `modules` at the top level AND
   * inside `details.modules`. The duplication is legacy back-compat —
   * older consumers read `details.modules`. Removing one or the other
   * would be a public API change.
   */
  async aggregate(): Promise<IHealthStatus> {
    const modules: Record<string, IHealthStatus> = {};
    let overall: IHealthStatus['status'] = 'healthy';

    for (const module of this.ctx.modules()) {
      if (!module.health) continue;
      try {
        const result = await module.health();
        modules[module.name] = result;
        overall = worse(overall, result.status);
      } catch (error) {
        modules[module.name] = {
          status: 'unhealthy',
          message: 'Health check failed',
          details: { error: error instanceof Error ? error.message : 'Unknown error' },
        };
        overall = 'unhealthy';
      }
    }

    return {
      status: overall,
      message: `Application is ${overall}`,
      modules,
      details: {
        name: this.ctx.appName,
        version: this.ctx.appVersion,
        uptime: this.ctx.uptime,
        state: this.ctx.state,
        modules,
      },
    };
  }
}

/**
 * Status combinator. Encodes the partial ordering
 * `healthy < degraded < unhealthy` so `worse(a, b)` returns the
 * dominant status. Used to fold each module result into the running
 * overall status without nested conditionals.
 */
function worse(
  a: IHealthStatus['status'],
  b: IHealthStatus['status'],
): IHealthStatus['status'] {
  if (a === 'unhealthy' || b === 'unhealthy') return 'unhealthy';
  if (a === 'degraded' || b === 'degraded') return 'degraded';
  return 'healthy';
}

/**
 * Re-export the not-found error so callers that want the throwing
 * variant of `checkModule` can construct it with the same identity.
 *
 * @internal
 */
export const moduleNotFound = (name: string) => Errors.notFound('Module', name);
