/**
 * Event Module Tokens
 *
 * Centralized token definitions to avoid circular dependencies
 */

import { createToken, Token } from '@omnitron-dev/titan/nexus';
import type { EnhancedEventEmitter } from '@omnitron-dev/eventemitter';
import type { EventsService } from './events.service.js';
import type { EventBusService } from './event-bus.service.js';
import type { EventHistoryService } from './event-history.service.js';
import type { EventMetadataService } from './event-metadata.service.js';
import type { EventDiscoveryService } from './event-discovery.service.js';
import type { EventSchedulerService } from './event-scheduler.service.js';
import type { EventValidationService } from './event-validation.service.js';
import type { IEventEmitterOptions } from './types.js';

/**
 * Internal re-export of LOGGER_TOKEN from logger module.
 *
 * This re-export is ONLY for internal use within the events module to:
 * 1. Avoid circular dependencies
 * 2. Allow events services to inject the logger via DI
 *
 * IMPORTANT: This token is NOT exported from the public events module API (index.ts).
 * External consumers should always import LOGGER_TOKEN directly from the logger module:
 *
 * ```typescript
 * // ✅ CORRECT - Import from logger module
 * import { LOGGER_TOKEN } from '@omnitron-dev/titan/module/logger';
 *
 * // ❌ WRONG - Don't import from events module
 * // import { LOGGER_TOKEN } from '@omnitron-dev/titan/module/events';
 * ```
 *
 * @see {@link LOGGER_TOKEN} in '@omnitron-dev/titan/module/logger' for the canonical token
 */
export { LOGGER_TOKEN } from '@omnitron-dev/titan/module/logger';

// Core Tokens
export const EVENT_EMITTER_TOKEN: Token<EnhancedEventEmitter> = createToken<EnhancedEventEmitter>('EventEmitter');
export const EVENTS_SERVICE_TOKEN: Token<EventsService> = createToken<EventsService>('EventsService');
export const EVENT_METADATA_SERVICE_TOKEN: Token<EventMetadataService> =
  createToken<EventMetadataService>('EventMetadataService');
export const EVENT_DISCOVERY_SERVICE_TOKEN: Token<EventDiscoveryService> =
  createToken<EventDiscoveryService>('EventDiscoveryService');
export const EVENT_BUS_SERVICE_TOKEN: Token<EventBusService> = createToken<EventBusService>('EventBusService');
export const EVENT_SCHEDULER_SERVICE_TOKEN: Token<EventSchedulerService> =
  createToken<EventSchedulerService>('EventSchedulerService');
export const EVENT_VALIDATION_SERVICE_TOKEN: Token<EventValidationService> =
  createToken<EventValidationService>('EventValidationService');
export const EVENT_HISTORY_SERVICE_TOKEN: Token<EventHistoryService> =
  createToken<EventHistoryService>('EventHistoryService');
export const EVENT_OPTIONS_TOKEN: Token<IEventEmitterOptions> =
  createToken<IEventEmitterOptions>('EventEmitterOptions');
