/**
 * Notifications Channel System
 *
 * Comprehensive channel management for notification delivery.
 * Includes registry, interfaces, and concrete/abstract channel implementations.
 *
 * @module @omnitron-dev/titan/module/notifications/channel
 */

// ============================================================================
// Enums
// ============================================================================

export { ChannelType } from './channel.interface.js';

// ============================================================================
// Channel Registry
// ============================================================================

export { ChannelRegistry } from './channel-registry.js';

// ============================================================================
// Channel Implementations
// ============================================================================

export * from './channels/index.js';

// ============================================================================
// Types & Interfaces
// ============================================================================

export type {
  NotificationChannel,
  ChannelContent,
  ChannelSendResult,
  ChannelHealth,
  EmailContent,
  SMSContent,
  PushContent,
  InAppContent,
  WebhookContent,
} from './channel.interface.js';
