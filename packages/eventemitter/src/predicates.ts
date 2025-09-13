import { EventEmitter } from './emitter';

export const isEventEmitter = (obj: any) => obj instanceof EventEmitter;
