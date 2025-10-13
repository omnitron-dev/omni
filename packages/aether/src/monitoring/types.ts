/**
 * Monitoring System Types
 *
 * Core types and interfaces for the Aether monitoring system.
 */

/**
 * Log levels for monitoring
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Core Web Vitals metrics
 */
export interface WebVitals {
  /** First Contentful Paint - time to first content render */
  FCP?: number;
  /** Largest Contentful Paint - time to largest content render */
  LCP?: number;
  /** First Input Delay - time to first user interaction */
  FID?: number;
  /** Cumulative Layout Shift - visual stability */
  CLS?: number;
  /** Time to Interactive - time until page is fully interactive */
  TTI?: number;
  /** Time to First Byte - server response time */
  TTFB?: number;
  /** Interaction to Next Paint - responsiveness */
  INP?: number;
}

/**
 * Performance timing data
 */
export interface PerformanceTiming {
  /** DNS lookup time */
  dns?: number;
  /** TCP connection time */
  tcp?: number;
  /** Request time */
  request?: number;
  /** Response time */
  response?: number;
  /** DOM processing time */
  domProcessing?: number;
  /** DOM content loaded time */
  domContentLoaded?: number;
  /** Load complete time */
  loadComplete?: number;
  /** Time to first byte */
  ttfb?: number;
}

/**
 * Resource timing data
 */
export interface ResourceTiming {
  /** Resource name/URL */
  name: string;
  /** Resource type (script, stylesheet, image, etc.) */
  type: string;
  /** Duration in milliseconds */
  duration: number;
  /** Transfer size in bytes */
  transferSize?: number;
  /** Encoded body size */
  encodedBodySize?: number;
  /** Decoded body size */
  decodedBodySize?: number;
  /** Start time */
  startTime: number;
  /** Whether cached */
  cached?: boolean;
}

/**
 * Memory usage data
 */
export interface MemoryUsage {
  /** Used JS heap size in bytes */
  usedJSHeapSize?: number;
  /** Total JS heap size in bytes */
  totalJSHeapSize?: number;
  /** JS heap size limit in bytes */
  jsHeapSizeLimit?: number;
}

/**
 * Custom performance mark
 */
export interface PerformanceMark {
  /** Mark name */
  name: string;
  /** Start time */
  startTime: number;
  /** Duration (if measure) */
  duration?: number;
  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Error severity levels
 */
export type ErrorSeverity = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

/**
 * Error information
 */
export interface ErrorInfo {
  /** Error message */
  message: string;
  /** Error stack trace */
  stack?: string;
  /** Error name/type */
  name?: string;
  /** Component stack trace */
  componentStack?: string;
  /** Error severity */
  severity?: ErrorSeverity;
  /** Error fingerprint for grouping */
  fingerprint?: string[];
  /** Additional context */
  context?: Record<string, any>;
  /** User info */
  user?: UserInfo | null;
  /** Breadcrumbs leading to error */
  breadcrumbs?: Breadcrumb[];
  /** Tags for categorization */
  tags?: Record<string, string>;
  /** Timestamp */
  timestamp?: number;
}

/**
 * Breadcrumb for error tracking
 */
export interface Breadcrumb {
  /** Breadcrumb type */
  type: 'default' | 'navigation' | 'http' | 'user' | 'error' | 'console';
  /** Category */
  category?: string;
  /** Message */
  message?: string;
  /** Level */
  level?: LogLevel;
  /** Timestamp */
  timestamp: number;
  /** Additional data */
  data?: Record<string, any>;
}

/**
 * User information
 */
export interface UserInfo {
  /** User ID */
  id?: string;
  /** User email */
  email?: string;
  /** Username */
  username?: string;
  /** IP address */
  ipAddress?: string;
  /** Additional user properties */
  properties?: Record<string, any>;
}

/**
 * Session information
 */
export interface SessionInfo {
  /** Session ID */
  id: string;
  /** Session start time */
  startTime: number;
  /** Last activity time */
  lastActivity: number;
  /** Page views in session */
  pageViews: number;
  /** Events in session */
  events: number;
  /** Session duration */
  duration?: number;
}

/**
 * Analytics event
 */
export interface AnalyticsEvent {
  /** Event name */
  name: string;
  /** Event properties */
  properties?: Record<string, any>;
  /** Event timestamp */
  timestamp?: number;
  /** User ID */
  userId?: string;
  /** Session ID */
  sessionId?: string;
  /** Page URL */
  pageUrl?: string;
  /** Referrer */
  referrer?: string;
}

/**
 * Page view event
 */
export interface PageView {
  /** Page URL */
  url: string;
  /** Page title */
  title?: string;
  /** Referrer */
  referrer?: string;
  /** Timestamp */
  timestamp?: number;
  /** User ID */
  userId?: string;
  /** Session ID */
  sessionId?: string;
  /** Custom properties */
  properties?: Record<string, any>;
}

/**
 * Custom metric
 */
export interface CustomMetric {
  /** Metric name */
  name: string;
  /** Metric value */
  value: number;
  /** Metric unit */
  unit?: string;
  /** Metric tags */
  tags?: Record<string, string>;
  /** Timestamp */
  timestamp?: number;
}

/**
 * Integration configuration
 */
export interface IntegrationConfig {
  /** Whether integration is enabled */
  enabled?: boolean;
  /** Integration-specific options */
  options?: Record<string, any>;
}

/**
 * Sentry configuration
 */
export interface SentryConfig extends IntegrationConfig {
  /** Sentry DSN */
  dsn: string;
  /** Environment */
  environment?: string;
  /** Release version */
  release?: string;
  /** Sample rate (0-1) */
  sampleRate?: number;
  /** Traces sample rate (0-1) */
  tracesSampleRate?: number;
  /** Before send hook */
  beforeSend?: (event: any) => any;
  /** Before breadcrumb hook */
  beforeBreadcrumb?: (breadcrumb: Breadcrumb) => Breadcrumb | null;
  /** Ignore errors matching patterns */
  ignoreErrors?: (string | RegExp)[];
  /** Deny URLs matching patterns */
  denyUrls?: (string | RegExp)[];
}

/**
 * Google Analytics configuration
 */
export interface GoogleAnalyticsConfig extends IntegrationConfig {
  /** GA measurement ID */
  measurementId: string;
  /** GA4 stream ID */
  streamId?: string;
  /** Send page views automatically */
  sendPageViews?: boolean;
  /** Custom dimensions */
  customDimensions?: Record<string, string>;
  /** Debug mode */
  debug?: boolean;
}

/**
 * Mixpanel configuration
 */
export interface MixpanelConfig extends IntegrationConfig {
  /** Mixpanel token */
  token: string;
  /** Mixpanel API host */
  apiHost?: string;
  /** Track page views automatically */
  trackPageViews?: boolean;
  /** Persistence type */
  persistence?: 'cookie' | 'localStorage';
  /** Cross-subdomain cookie */
  crossSubdomainCookie?: boolean;
}

/**
 * Custom backend configuration
 */
export interface CustomBackendConfig extends IntegrationConfig {
  /** Backend endpoint URL */
  endpoint: string;
  /** API key */
  apiKey?: string;
  /** Batch size for events */
  batchSize?: number;
  /** Flush interval in ms */
  flushInterval?: number;
  /** Request headers */
  headers?: Record<string, string>;
}

/**
 * Webhook configuration
 */
export interface WebhookConfig extends IntegrationConfig {
  /** Webhook URL */
  url: string;
  /** HTTP method */
  method?: 'POST' | 'PUT' | 'PATCH';
  /** Request headers */
  headers?: Record<string, string>;
  /** Event filter */
  eventFilter?: (event: any) => boolean;
}

/**
 * Privacy configuration
 */
export interface PrivacyConfig {
  /** Enable cookie consent */
  cookieConsent?: boolean;
  /** Respect Do Not Track */
  respectDoNotTrack?: boolean;
  /** Anonymize IP addresses */
  anonymizeIp?: boolean;
  /** Data retention period in days */
  dataRetention?: number;
  /** GDPR compliance mode */
  gdprCompliance?: boolean;
  /** Cookie consent callback */
  onConsentChange?: (consent: ConsentState) => void;
}

/**
 * Consent state
 */
export interface ConsentState {
  /** Analytics consent */
  analytics: boolean;
  /** Performance monitoring consent */
  performance: boolean;
  /** Error tracking consent */
  errorTracking: boolean;
  /** Marketing consent */
  marketing?: boolean;
}

/**
 * Monitoring configuration
 */
export interface MonitoringConfig {
  /** Enable monitoring */
  enabled?: boolean;
  /** Environment (development, staging, production) */
  environment?: string;
  /** Application version */
  version?: string;
  /** Enable performance monitoring */
  performance?: boolean | PerformanceMonitoringConfig;
  /** Enable error tracking */
  errorTracking?: boolean | ErrorTrackingConfig;
  /** Enable analytics */
  analytics?: boolean;
  /** Enable Real User Monitoring */
  rum?: boolean;
  /** Sample rate (0-1) for all monitoring */
  sampleRate?: number;
  /** Debug mode */
  debug?: boolean;
  /** Sentry integration */
  sentry?: SentryConfig;
  /** Google Analytics integration */
  googleAnalytics?: GoogleAnalyticsConfig;
  /** Mixpanel integration */
  mixpanel?: MixpanelConfig;
  /** Custom backend integration */
  customBackend?: CustomBackendConfig;
  /** Webhook integration */
  webhook?: WebhookConfig;
  /** Privacy settings */
  privacy?: PrivacyConfig;
  /** User info provider */
  userInfoProvider?: () => UserInfo | Promise<UserInfo>;
  /** Before send hook */
  beforeSend?: (event: any) => any | null;
  /** Developer tools */
  devtools?: boolean | DevToolsConfig;
}

/**
 * Performance monitoring configuration
 */
export interface PerformanceMonitoringConfig {
  /** Track Core Web Vitals */
  webVitals?: boolean;
  /** Track resource timing */
  resourceTiming?: boolean;
  /** Track navigation timing */
  navigationTiming?: boolean;
  /** Track memory usage */
  memoryUsage?: boolean;
  /** Track bundle size */
  bundleSize?: boolean;
  /** Sample rate (0-1) */
  sampleRate?: number;
  /** Report threshold in ms */
  reportThreshold?: number;
}

/**
 * Error tracking configuration
 */
export interface ErrorTrackingConfig {
  /** Auto-capture errors */
  autoCapture?: boolean;
  /** Max breadcrumbs to keep */
  maxBreadcrumbs?: number;
  /** Attach stack traces */
  attachStackTrace?: boolean;
  /** Attach component stack */
  attachComponentStack?: boolean;
  /** Error grouping */
  grouping?: 'auto' | 'fingerprint';
  /** Sample rate (0-1) */
  sampleRate?: number;
}

/**
 * Developer tools configuration
 */
export interface DevToolsConfig {
  /** Enable performance profiler */
  profiler?: boolean;
  /** Enable bundle analyzer */
  bundleAnalyzer?: boolean;
  /** Enable memory leak detection */
  memoryLeakDetection?: boolean;
  /** Enable network viewer */
  networkViewer?: boolean;
  /** Enable component tracking */
  componentTracking?: boolean;
}

/**
 * Monitoring instance interface
 */
export interface MonitoringInstance {
  /** Initialize monitoring */
  init(config: MonitoringConfig): void;
  /** Track error */
  trackError(error: Error, info?: Partial<ErrorInfo>): void;
  /** Track event */
  trackEvent(name: string, properties?: Record<string, any>): void;
  /** Track page view */
  trackPageView(view: Partial<PageView>): void;
  /** Track custom metric */
  trackMetric(metric: CustomMetric): void;
  /** Set user */
  setUser(user: UserInfo | null): void;
  /** Add breadcrumb */
  addBreadcrumb(breadcrumb: Breadcrumb): void;
  /** Start performance mark */
  startMark(name: string, metadata?: Record<string, any>): void;
  /** End performance mark */
  endMark(name: string): void;
  /** Measure performance */
  measure(name: string, startMark: string, endMark?: string): number;
  /** Get Web Vitals */
  getWebVitals(): WebVitals;
  /** Flush pending events */
  flush(): Promise<void>;
  /** Shutdown monitoring */
  shutdown(): Promise<void>;
}
