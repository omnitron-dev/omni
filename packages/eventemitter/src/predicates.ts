import { EventEmitter } from './emitter.js';
import { EnhancedEventEmitter } from './enhanced-emitter.js';

export const isEventEmitter = (obj: any) => obj instanceof EventEmitter;

export const isEnhancedEventEmitter = (obj: any) => obj instanceof EnhancedEventEmitter;