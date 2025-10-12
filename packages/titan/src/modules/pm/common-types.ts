/**
 * Common type definitions for Process Manager module
 * to ensure type safety and eliminate 'any' usage
 */

// Handler types
export type MessageHandler = (message: any) => void | Promise<void>;
export type EventHandler = (...args: any[]) => void | Promise<void>;
export type ProcessMethod = (...args: any[]) => any;
export type AsyncProcessMethod = (...args: any[]) => Promise<any>;
export type StreamingMethod = (...args: any[]) => AsyncGenerator<any, any, any>;

// Worker message types
export interface WorkerMessage {
  type: string;
  id?: string;
  method?: string;
  args?: any[];
  result?: any;
  error?: any;
  chunk?: any;
}

// Method descriptor
export interface MethodDescriptor {
  name: string;
  handler: ProcessMethod;
  isAsync?: boolean;
  isStreaming?: boolean;
}

// Service method map
export type ServiceMethodMap = Map<string, ProcessMethod>;

// Process context
export interface ProcessContext {
  processId: string;
  serviceName: string;
  metadata?: Record<string, any>;
}

// Workflow handler
export type WorkflowHandler = (input: any) => Promise<any>;

// Type guards
export function isAsyncGenerator(value: any): value is AsyncGenerator {
  return (
    value && typeof value.next === 'function' && typeof value.throw === 'function' && typeof value.return === 'function'
  );
}

export function isPromise(value: any): value is Promise<any> {
  return value && typeof value.then === 'function';
}
