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

// Service tokens
export const NOTIFICATION_SERVICE = createToken<NotificationService>('NOTIFICATION_SERVICE');
export const CHANNEL_MANAGER = createToken<ChannelManager>('CHANNEL_MANAGER');
export const PREFERENCE_MANAGER = createToken<PreferenceManager>('PREFERENCE_MANAGER');
export const RATE_LIMITER = createToken<RateLimiter>('RATE_LIMITER');
export const TEMPLATE_ENGINE = createToken<TemplateEngine>('TEMPLATE_ENGINE');
export const WORKFLOW_ENGINE = createToken<WorkflowEngine>('WORKFLOW_ENGINE');
export const ANALYTICS_SERVICE = createToken<NotificationAnalytics>('ANALYTICS_SERVICE');
export const ROTIF_MANAGER = createToken<NotificationManager>('ROTIF_MANAGER');

// Configuration token
export const NOTIFICATION_MODULE_OPTIONS = createToken<NotificationModuleOptions>('NOTIFICATION_MODULE_OPTIONS');

// Channel type constants
export const DEFAULT_CHANNELS = ['inApp'] as const;
export const ALL_CHANNELS = ['email', 'sms', 'push', 'webhook', 'inApp'] as const;

// Priority levels
export const PRIORITY_LEVELS = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent'
} as const;

// Notification types
export const NOTIFICATION_TYPES = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical'
} as const;

// Default configuration values
export const DEFAULT_RATE_LIMITS = {
  perMinute: 10,
  perHour: 100,
  perDay: 1000
};

export const DEFAULT_DEDUPLICATION_TTL = 86400; // 24 hours in seconds
export const DEFAULT_BATCH_SIZE = 1000;
export const DEFAULT_RETRY_ATTEMPTS = 3;
export const DEFAULT_TIMEOUT = 30000; // 30 seconds

// Redis key prefixes
export const REDIS_KEY_PREFIXES = {
  PREFERENCES: 'notifications:preferences:',
  RATE_LIMIT: 'notifications:ratelimit:',
  SCHEDULE: 'notifications:schedule:',
  ANALYTICS: 'notifications:analytics:',
  TEMPLATE: 'notifications:template:',
  WORKFLOW: 'notifications:workflow:'
} as const;