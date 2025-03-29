import { AsyncEventEmitter } from "./emitter";

export const isAsyncEventEmitter = (obj: any) => obj instanceof AsyncEventEmitter;
