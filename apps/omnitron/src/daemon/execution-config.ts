import type { IProcessManagerConfig } from '@omnitron-dev/titan-pm';
import type { IEcosystemConfig, IDaemonConfig } from '../config/types.js';
import type { OrchestratorControl } from '../orchestrator/execution-contract.js';
import { LogManager } from '../monitoring/log-manager.js';
import { expandPath } from '../shared/paths.js';

export function executionProcessConfig(ecosystemConfig: IEcosystemConfig): IProcessManagerConfig {
  return {
    isolation: 'child',
    transport: 'unix',
    // The orchestrator subscribes to `onLog` itself and feeds
    // `LogCollector` under the app's own name. PM's default forwarding
    // re-logs the same line through the daemon's logger, where it is
    // ingested a second time as `omnitron` — so every child line was
    // stored twice: the table paid for both copies (13 GB here, roughly
    // half of it the second one), and every per-app count was wrong by
    // whichever component happened to emit the line.
    //
    // Measured on this host before the fix: 42 958 rows under `omnitron`
    // against 36 160 under every app combined, for the same hour.
    forwardChildLogs: false,
    restartPolicy: {
      enabled: true,
      maxRestarts: ecosystemConfig.supervision.maxRestarts,
      window: ecosystemConfig.supervision.window,
      backoff: ecosystemConfig.supervision.backoff,
    },
    resources: {
      timeout: 60_000, // Allow up to 60s for tsx/bootstrap startup
    },
    monitoring: {
      healthCheck: {
        interval: ecosystemConfig.monitoring.healthCheck.interval,
        timeout: ecosystemConfig.monitoring.healthCheck.timeout,
      },
      metrics: true,
    },
};
}

export function executionLogManager(ecosystemConfig: IEcosystemConfig, dc: IDaemonConfig, orchestrator: OrchestratorControl, capture = true): LogManager {
  // Build per-app rotation overrides from ecosystem config
  const perApp = new Map<string, { maxSize?: string; maxFiles?: number; compress?: boolean }>();
  for (const app of ecosystemConfig.apps) {
    const logging = (app as typeof app & { observability?: { logging?: { maxSize?: string; maxFiles?: number; compress?: boolean } } }).observability?.logging;
    if (logging?.maxSize || logging?.maxFiles != null || logging?.compress != null) {
      perApp.set(app.name, {
        ...(logging.maxSize !== undefined && { maxSize: logging.maxSize }),
        ...(logging.maxFiles !== undefined && { maxFiles: logging.maxFiles }),
        ...(logging.compress !== undefined && { compress: logging.compress }),
      });
    }
  }
  const baseDir = expandPath(dc.logDir).replace(/\/logs\/?$/, '');
  return new LogManager(
    {
      baseDir,
      ...(capture ? { journalPath: `${baseDir}/data/application-logs.sqlite` } : {}),
      defaults: {
        maxSize: ecosystemConfig.logging.maxSize,
        maxFiles: ecosystemConfig.logging.maxFiles,
        compress: ecosystemConfig.logging.compress,
      },
      perApp,
    },
    orchestrator,
  );

}
