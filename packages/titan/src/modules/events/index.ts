/**
 * Events Module exports
 */

export * from './types.js';
export * from './events.module.js';
export * from './events.service.js';
export * from './event-bus.service.js';
export * from './event-history.service.js';
export * from './event-metadata.service.js';
export * from './event-discovery.service.js';
export * from './event-scheduler.service.js';
export * from './event-validation.service.js';

// Re-export event decorators from main decorators file
export {
  OnEvent,
  OnceEvent,
  EmitEvent,
  OnAnyEvent,
  BatchEvents,
  EventEmitter,
  ScheduleEvent
} from '../../decorators.js';