import { EventEmitter } from './emitter';
import { EnhancedEventEmitter } from './enhanced-emitter';

export const isEventEmitter = (obj: any) => obj instanceof EventEmitter;

export const isEnhancedEventEmitter = (obj: any) => obj instanceof EnhancedEventEmitter;