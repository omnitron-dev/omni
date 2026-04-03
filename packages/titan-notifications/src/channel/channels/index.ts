/**
 * Channel Implementations
 *
 * Export all concrete and abstract channel implementations.
 *
 * @module @omnitron-dev/titan/module/notifications/channel/channels
 */

// ============================================================================
// Concrete Implementations
// ============================================================================

export { InAppChannel, REDIS_CLIENT } from './inapp.channel.js';
export { WebhookChannel, verifyWebhookSignature } from './webhook.channel.js';

// ============================================================================
// Abstract Base Classes
// ============================================================================

export { AbstractEmailChannel, MockEmailChannel } from './email.channel.js';
export { AbstractSMSChannel, MockSMSChannel } from './sms.channel.js';
export { AbstractPushChannel, MockPushChannel } from './push.channel.js';

// ============================================================================
// Types & Interfaces
// ============================================================================

export type { InAppChannelOptions } from './inapp.channel.js';
export type { WebhookChannelOptions } from './webhook.channel.js';
export type { EmailChannelOptions } from './email.channel.js';
export type { SMSChannelOptions } from './sms.channel.js';
export type { PushChannelOptions, PushSendResult } from './push.channel.js';
