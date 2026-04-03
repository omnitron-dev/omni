import { createToken, type Token } from '@omnitron-dev/titan/nexus';
import type {
  IRateLimiter,
  IPreferenceStore,
  IChannelRouter,
  NotificationsModuleOptions,
} from './notifications.types.js';
import type { MessagingTransport } from './transport/transport.interface.js';
import type { ChannelRegistry } from './channel/channel-registry.js';
import type { NotificationsEventEmitter } from './notifications.events.js';
import type { TemplateEngine } from './template-engine.js';
import type { RedisRateLimiter } from './redis-rate-limiter.js';
import type { RedisPreferenceStore } from './redis-preference-store.js';

// Forward declarations for services/indicators that will be implemented
export interface NotificationsService {
  send(...args: any[]): Promise<any>;
  broadcast(...args: any[]): Promise<any>;
  schedule(...args: any[]): Promise<any>;
  cancel(...args: any[]): Promise<any>;
  getStatus(...args: any[]): Promise<any>;
}

export interface NotificationsHealthIndicator {
  check(...args: any[]): Promise<any>;
}

// Core tokens
export const NOTIFICATIONS_SERVICE: Token<NotificationsService> = createToken('NotificationsService');
export const NOTIFICATIONS_TRANSPORT: Token<MessagingTransport> = createToken('NotificationsTransport');
export const NOTIFICATIONS_MODULE_OPTIONS: Token<NotificationsModuleOptions> =
  createToken('NotificationsModuleOptions');
export const NOTIFICATIONS_HEALTH: Token<NotificationsHealthIndicator> = createToken('NotificationsHealth');

// Optional feature tokens
export const NOTIFICATIONS_RATE_LIMITER: Token<IRateLimiter> = createToken('NotificationsRateLimiter');
export const NOTIFICATIONS_PREFERENCE_STORE: Token<IPreferenceStore> = createToken('NotificationsPreferenceStore');
export const NOTIFICATIONS_CHANNEL_ROUTER: Token<IChannelRouter> = createToken('NotificationsChannelRouter');
export const NOTIFICATIONS_CHANNEL_REGISTRY: Token<ChannelRegistry> = createToken('NotificationsChannelRegistry');
export const NOTIFICATIONS_EVENT_EMITTER: Token<NotificationsEventEmitter> = createToken('NotificationsEventEmitter');

// New component tokens
export const NOTIFICATIONS_TEMPLATE_ENGINE: Token<TemplateEngine> = createToken('NotificationsTemplateEngine');
export const NOTIFICATIONS_REDIS_RATE_LIMITER: Token<RedisRateLimiter> = createToken('NotificationsRedisRateLimiter');
export const NOTIFICATIONS_REDIS_PREFERENCE_STORE: Token<RedisPreferenceStore> = createToken(
  'NotificationsRedisPreferenceStore'
);
