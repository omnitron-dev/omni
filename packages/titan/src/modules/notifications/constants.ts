import { createToken } from '../../nexus/index.js';
import type { NotificationService } from './notifications.service.js';
import type { ChannelManager } from './channel-manager.js';
import type { PreferenceManager } from './preference-manager.js';
import type { RateLimiter } from './rate-limiter.js';
import type { TemplateEngine } from './template-engine.js';
import type { WorkflowEngine } from './workflow-engine.js';
import type { NotificationAnalytics } from './analytics.js';
import type { NotificationManager } from '../../rotif/rotif.js';
import type { NotificationModuleOptions } from './notifications.module.js';

// Service tokens - standardized with _TOKEN suffix
export const NOTIFICATION_SERVICE_TOKEN = createToken<NotificationService>('NOTIFICATION_SERVICE_TOKEN');
export const CHANNEL_MANAGER_TOKEN = createToken<ChannelManager>('CHANNEL_MANAGER_TOKEN');
export const PREFERENCE_MANAGER_TOKEN = createToken<PreferenceManager>('PREFERENCE_MANAGER_TOKEN');
export const RATE_LIMITER_TOKEN = createToken<RateLimiter>('RATE_LIMITER_TOKEN');
export const TEMPLATE_ENGINE_TOKEN = createToken<TemplateEngine>('TEMPLATE_ENGINE_TOKEN');
export const WORKFLOW_ENGINE_TOKEN = createToken<WorkflowEngine>('WORKFLOW_ENGINE_TOKEN');
export const ANALYTICS_SERVICE_TOKEN = createToken<NotificationAnalytics>('ANALYTICS_SERVICE_TOKEN');
export const ROTIF_MANAGER_TOKEN = createToken<NotificationManager>('ROTIF_MANAGER_TOKEN');

// Configuration token
export const NOTIFICATION_MODULE_OPTIONS_TOKEN = createToken<NotificationModuleOptions>(
  'NOTIFICATION_MODULE_OPTIONS_TOKEN'
);

// Legacy exports for backward compatibility (deprecated)
/** @deprecated Use NOTIFICATION_SERVICE_TOKEN instead */
export const NOTIFICATION_SERVICE = NOTIFICATION_SERVICE_TOKEN;
/** @deprecated Use CHANNEL_MANAGER_TOKEN instead */
export const CHANNEL_MANAGER = CHANNEL_MANAGER_TOKEN;
/** @deprecated Use PREFERENCE_MANAGER_TOKEN instead */
export const PREFERENCE_MANAGER = PREFERENCE_MANAGER_TOKEN;
/** @deprecated Use RATE_LIMITER_TOKEN instead */
export const RATE_LIMITER = RATE_LIMITER_TOKEN;
/** @deprecated Use TEMPLATE_ENGINE_TOKEN instead */
export const TEMPLATE_ENGINE = TEMPLATE_ENGINE_TOKEN;
/** @deprecated Use WORKFLOW_ENGINE_TOKEN instead */
export const WORKFLOW_ENGINE = WORKFLOW_ENGINE_TOKEN;
/** @deprecated Use ANALYTICS_SERVICE_TOKEN instead */
export const ANALYTICS_SERVICE = ANALYTICS_SERVICE_TOKEN;
/** @deprecated Use ROTIF_MANAGER_TOKEN instead */
export const ROTIF_MANAGER = ROTIF_MANAGER_TOKEN;
/** @deprecated Use NOTIFICATION_MODULE_OPTIONS_TOKEN instead */
export const NOTIFICATION_MODULE_OPTIONS = NOTIFICATION_MODULE_OPTIONS_TOKEN;

// Channel type constants
export const DEFAULT_CHANNELS = ['inApp'] as const;
export const ALL_CHANNELS = ['email', 'sms', 'push', 'webhook', 'inApp'] as const;

// Priority levels
export const PRIORITY_LEVELS = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent',
} as const;

// Notification types
export const NOTIFICATION_TYPES = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical',
} as const;

// Default configuration values
export const DEFAULT_RATE_LIMITS = {
  perMinute: 10,
  perHour: 100,
  perDay: 1000,
};

export const DEFAULT_DEDUPLICATION_TTL = 86400; // 24 hours in seconds
export const DEFAULT_BATCH_SIZE = 1000;
export const DEFAULT_RETRY_ATTEMPTS = 3;
export const DEFAULT_TIMEOUT = 30000; // 30 seconds

// Redis connection defaults
export const DEFAULT_REDIS_HOST = 'localhost';
export const DEFAULT_REDIS_PORT = 6379;
export const DEFAULT_REDIS_DB = 0;

// Redis key prefixes
export const REDIS_KEY_PREFIXES = {
  PREFERENCES: 'notifications:preferences:',
  RATE_LIMIT: 'notifications:ratelimit:',
  SCHEDULE: 'notifications:schedule:',
  ANALYTICS: 'notifications:analytics:',
  TEMPLATE: 'notifications:template:',
  WORKFLOW: 'notifications:workflow:',
} as const;
