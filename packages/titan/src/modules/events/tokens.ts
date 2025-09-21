/**
 * Event Module Tokens
 *
 * Centralized token definitions to avoid circular dependencies
 */

import { createToken, Token } from '@omnitron-dev/nexus';
import type { EnhancedEventEmitter } from '@omnitron-dev/eventemitter';
import type { EventsService } from './events.service.js';
import type { EventBusService } from './event-bus.service.js';
import type { EventHistoryService } from './event-history.service.js';
import type { EventMetadataService } from './event-metadata.service.js';
import type { EventDiscoveryService } from './event-discovery.service.js';
import type { EventSchedulerService } from './event-scheduler.service.js';
import type { EventValidationService } from './event-validation.service.js';
import type { IEventEmitterOptions } from './types.js';

// Core Tokens
export const EVENT_EMITTER_TOKEN: Token<EnhancedEventEmitter> = createToken<EnhancedEventEmitter>('EventEmitter');
export const EVENTS_SERVICE_TOKEN: Token<EventsService> = createToken<EventsService>('EventsService');
export const EVENT_METADATA_SERVICE_TOKEN: Token<EventMetadataService> = createToken<EventMetadataService>('EventMetadataService');
export const EVENT_DISCOVERY_SERVICE_TOKEN: Token<EventDiscoveryService> = createToken<EventDiscoveryService>('EventDiscoveryService');
export const EVENT_BUS_SERVICE_TOKEN: Token<EventBusService> = createToken<EventBusService>('EventBusService');
export const EVENT_SCHEDULER_SERVICE_TOKEN: Token<EventSchedulerService> = createToken<EventSchedulerService>('EventSchedulerService');
export const EVENT_VALIDATION_SERVICE_TOKEN: Token<EventValidationService> = createToken<EventValidationService>('EventValidationService');
export const EVENT_HISTORY_SERVICE_TOKEN: Token<EventHistoryService> = createToken<EventHistoryService>('EventHistoryService');
export const EVENT_OPTIONS_TOKEN: Token<IEventEmitterOptions> = createToken<IEventEmitterOptions>('EventEmitterOptions');
export const LOGGER_TOKEN: Token<any> = createToken<any>('Logger');