/**
 * Aether Monitoring System
 *
 * Production-ready monitoring and analytics for the Aether framework.
 * Includes error tracking, performance monitoring, analytics, and integrations.
 */

// Main monitoring API
export { Monitoring, monitor, getMonitoring, initMonitoring } from './monitoring.js';

// Core modules
export {
  ErrorTracker,
  getErrorTracker,
  resetErrorTracker,
  ErrorBoundaryIntegration,
  ErrorGrouping,
  SourceMapSupport,
} from './error-tracking.js';

export { PerformanceMonitor, getPerformanceMonitor, resetPerformanceMonitor } from './performance.js';

export { Analytics, getAnalytics, resetAnalytics, ABTest, ConversionTracker } from './analytics.js';

export { PrivacyManager, getPrivacyManager, resetPrivacyManager, ConsentBanner } from './privacy.js';

export { DevTools, getDevTools, resetDevTools, Profile } from './devtools.js';

// Integrations
export {
  SentryIntegration,
  createSentryIntegration,
  GoogleAnalyticsIntegration,
  createGoogleAnalyticsIntegration,
  MixpanelIntegration,
  createMixpanelIntegration,
  CustomBackendIntegration,
  WebhookIntegration,
  createCustomBackendIntegration,
  createWebhookIntegration,
} from './integrations/index.js';

// Types
export type {
  // Core types
  LogLevel,
  ErrorSeverity,
  ErrorInfo,
  Breadcrumb,
  UserInfo,
  SessionInfo,
  AnalyticsEvent,
  PageView,
  CustomMetric,

  // Performance types
  WebVitals,
  PerformanceTiming,
  ResourceTiming,
  MemoryUsage,
  PerformanceMark,

  // Config types
  MonitoringConfig,
  PerformanceMonitoringConfig,
  ErrorTrackingConfig,
  DevToolsConfig,
  PrivacyConfig,
  ConsentState,

  // Integration types
  IntegrationConfig,
  SentryConfig,
  GoogleAnalyticsConfig,
  MixpanelConfig,
  CustomBackendConfig,
  WebhookConfig,

  // Instance type
  MonitoringInstance,
} from './types.js';
