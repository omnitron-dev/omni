/**
 * @omnitron-dev/omnitron — Public API
 *
 * defineSystem() and defineEcosystem() are the main exports
 * for apps and the root omnitron.config.ts.
 */

export { defineSystem } from './config/define-system.js';
export { defineEcosystem } from './config/define-ecosystem.js';

export type {
  IAppDefinition,
  IProcessEntry,
  /** @deprecated Use IProcessEntry instead */
  IProcessTopologyEntry,
  IEcosystemConfig,
  IEcosystemAppEntry,
  IWatchConfig,
  IHttpTransportConfig,
  IWebSocketTransportConfig,
  ProcessInfoDto,
  SubProcessInfoDto,
  DaemonStatusDto,
  AggregatedMetricsDto,
  AggregatedHealthDto,
  LogEntryDto,
  AppDiagnosticsDto,
  AppStatus,
} from './config/types.js';
