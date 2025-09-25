// Main module exports
export { TitanNotificationsModule } from './notifications.module.js';
export type {
  NotificationModuleOptions,
  NotificationOptionsFactory,
  NotificationModuleAsyncOptions
} from './notifications.module.js';

// Service exports
export { NotificationService } from './notifications.service.js';
export type {
  NotificationPayload,
  NotificationMetadata,
  Recipient,
  SendOptions,
  NotificationResult,
  BroadcastTarget,
  BroadcastOptions,
  BroadcastResult,
  ScheduleOptions,
  ScheduleResult
} from './notifications.service.js';

// Channel manager exports
export { ChannelManager, InAppChannel, EmailChannel, SMSChannel } from './channel-manager.js';
export { ChannelType } from './channel-manager.js';
export type {
  NotificationChannel,
  ChannelContent,
  RecipientGroup,
  DeliveryRecord,
  FailureRecord,
  DeliveryResults,
  ProcessedNotification
} from './channel-manager.js';

// Preference manager exports
export { PreferenceManager } from './preference-manager.js';
export type {
  UserPreferences,
  ChannelPreference,
  CategoryPreference,
  FrequencyLimit,
  QuietHours
} from './preference-manager.js';

// Rate limiter exports
export { RateLimiter } from './rate-limiter.js';
export type {
  RateLimitConfig,
  RateLimitResult
} from './rate-limiter.js';

// Template engine exports
export { TemplateEngine } from './template-engine.js';
export type {
  TemplateOptions,
  RenderOptions,
  RenderedContent,
  NotificationTemplate,
  TemplateVariable
} from './template-engine.js';

// Workflow engine exports
export { WorkflowEngine } from './workflow-engine.js';
export type {
  WorkflowOptions,
  NotificationWorkflow,
  WorkflowTrigger,
  WorkflowStep,
  StepCondition,
  WorkflowContext,
  WorkflowInstance,
  StepResult,
  WorkflowResult
} from './workflow-engine.js';

// Analytics exports
export { NotificationAnalytics } from './analytics.js';
export type {
  AnalyticsOptions,
  NotificationEvent,
  AnalyticsQuery,
  NotificationStatistics,
  ChannelStatistics,
  TimeSeriesData,
  NotificationReport,
  ReportPeriod,
  TopPerformer,
  Issue,
  PeriodComparison
} from './analytics.js';

// Constants exports
export {
  NOTIFICATION_SERVICE,
  CHANNEL_MANAGER,
  PREFERENCE_MANAGER,
  RATE_LIMITER,
  TEMPLATE_ENGINE,
  WORKFLOW_ENGINE,
  ANALYTICS_SERVICE,
  ROTIF_MANAGER,
  NOTIFICATION_MODULE_OPTIONS,
  DEFAULT_CHANNELS,
  ALL_CHANNELS,
  PRIORITY_LEVELS,
  NOTIFICATION_TYPES,
  DEFAULT_RATE_LIMITS,
  DEFAULT_DEDUPLICATION_TTL,
  DEFAULT_BATCH_SIZE,
  DEFAULT_RETRY_ATTEMPTS,
  DEFAULT_TIMEOUT,
  REDIS_KEY_PREFIXES
} from './constants.js';

// Utility exports
export {
  generateUuid,
  isValidEmail,
  isValidPhone,
  isValidUrl,
  hash,
  parseTimeToMinutes,
  formatTimestamp,
  sleep,
  chunk,
  retry,
  createDeferred
} from './utils.js';