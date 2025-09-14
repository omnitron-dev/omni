/**
 * Distributed Tracing support for Nexus DI
 * 
 * @module tracing
 * @packageDocumentation
 * 
 * Provides OpenTelemetry integration and distributed tracing capabilities
 */

import { InjectionToken, ResolutionContext } from '../types/core';
import { Container } from '../container/container';
import { Plugin, PluginHooks } from '../plugins/plugin';
import { createToken } from '../token/token';

/**
 * Span attributes
 */
export interface SpanAttributes {
  [key: string]: string | number | boolean | undefined;
}

/**
 * Span context
 */
export interface SpanContext {
  traceId: string;
  spanId: string;
  traceFlags: number;
  traceState?: string;
}

/**
 * Span status
 */
export interface SpanStatus {
  code: 'UNSET' | 'OK' | 'ERROR';
  message?: string;
}

/**
 * Span interface
 */
export interface Span {
  spanContext(): SpanContext;
  setAttribute(key: string, value: string | number | boolean): void;
  setAttributes(attributes: SpanAttributes): void;
  addEvent(name: string, attributes?: SpanAttributes): void;
  setStatus(status: SpanStatus): void;
  end(endTime?: number): void;
  isRecording(): boolean;
}

/**
 * Tracer interface
 */
export interface Tracer {
  startSpan(name: string, options?: SpanOptions): Span;
  startActiveSpan<T>(name: string, fn: (span: Span) => T): T;
  startActiveSpanAsync<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T>;
}

/**
 * Span options
 */
export interface SpanOptions {
  kind?: 'INTERNAL' | 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER';
  attributes?: SpanAttributes;
  links?: SpanLink[];
  startTime?: number;
  root?: boolean;
}

/**
 * Span link
 */
export interface SpanLink {
  context: SpanContext;
  attributes?: SpanAttributes;
}

/**
 * Trace exporter interface
 */
export interface TraceExporter {
  export(spans: Span[]): Promise<void>;
  shutdown(): Promise<void>;
}

/**
 * Propagator interface for context propagation
 */
export interface Propagator {
  inject(context: SpanContext, carrier: any): void;
  extract(carrier: any): SpanContext | null;
}

/**
 * Simple span implementation
 */
class SimpleSpan implements Span {
  private context: SpanContext;
  private attributes: SpanAttributes = {};
  private events: Array<{ name: string; timestamp: number; attributes?: SpanAttributes }> = [];
  private status: SpanStatus = { code: 'UNSET' };
  private endTime?: number;
  private recording = true;
  
  constructor(
    name: string,
    context: SpanContext,
    private exporter?: TraceExporter
  ) {
    this.context = context;
    this.setAttribute('span.name', name);
  }
  
  spanContext(): SpanContext {
    return this.context;
  }
  
  setAttribute(key: string, value: string | number | boolean): void {
    if (this.recording) {
      this.attributes[key] = value;
    }
  }
  
  setAttributes(attributes: SpanAttributes): void {
    if (this.recording) {
      Object.assign(this.attributes, attributes);
    }
  }
  
  addEvent(name: string, attributes?: SpanAttributes): void {
    if (this.recording) {
      this.events.push({
        name,
        timestamp: Date.now(),
        attributes
      });
    }
  }
  
  setStatus(status: SpanStatus): void {
    if (this.recording) {
      this.status = status;
    }
  }
  
  end(endTime?: number): void {
    if (this.recording) {
      this.endTime = endTime || Date.now();
      this.recording = false;
      
      // Export the span if exporter is available
      if (this.exporter) {
        this.exporter.export([this]).catch(console.error);
      }
    }
  }
  
  isRecording(): boolean {
    return this.recording;
  }
  
  toJSON(): any {
    return {
      context: this.context,
      attributes: this.attributes,
      events: this.events,
      status: this.status,
      endTime: this.endTime
    };
  }
}

/**
 * Simple tracer implementation
 */
export class SimpleTracer implements Tracer {
  private activeSpan?: Span;
  private exporter?: TraceExporter;
  
  constructor(exporter?: TraceExporter) {
    this.exporter = exporter;
  }
  
  startSpan(name: string, options?: SpanOptions): Span {
    const context: SpanContext = {
      traceId: this.generateTraceId(),
      spanId: this.generateSpanId(),
      traceFlags: 1
    };
    
    const span = new SimpleSpan(name, context, this.exporter);
    
    if (options?.attributes) {
      span.setAttributes(options.attributes);
    }
    
    if (options?.kind) {
      span.setAttribute('span.kind', options.kind);
    }
    
    return span;
  }
  
  startActiveSpan<T>(name: string, fn: (span: Span) => T): T {
    const span = this.startSpan(name);
    const previousSpan = this.activeSpan;
    this.activeSpan = span;
    
    try {
      const result = fn(span);
      span.setStatus({ code: 'OK' });
      return result;
    } catch (error) {
      span.setStatus({ code: 'ERROR', message: String(error) });
      throw error;
    } finally {
      span.end();
      this.activeSpan = previousSpan;
    }
  }
  
  async startActiveSpanAsync<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
    const span = this.startSpan(name);
    const previousSpan = this.activeSpan;
    this.activeSpan = span;
    
    try {
      const result = await fn(span);
      span.setStatus({ code: 'OK' });
      return result;
    } catch (error) {
      span.setStatus({ code: 'ERROR', message: String(error) });
      throw error;
    } finally {
      span.end();
      this.activeSpan = previousSpan;
    }
  }
  
  getActiveSpan(): Span | undefined {
    return this.activeSpan;
  }
  
  private generateTraceId(): string {
    return Array.from({ length: 32 }, () => 
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
  }
  
  private generateSpanId(): string {
    return Array.from({ length: 16 }, () => 
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
  }
}

/**
 * Jaeger exporter
 */
export class JaegerExporter implements TraceExporter {
  private endpoint: string;
  private serviceName: string;
  private batch: Span[] = [];
  private batchSize = 100;
  private flushInterval = 5000;
  private timer?: NodeJS.Timeout;
  
  constructor(config: {
    endpoint: string;
    serviceName: string;
    batchSize?: number;
    flushInterval?: number;
  }) {
    this.endpoint = config.endpoint;
    this.serviceName = config.serviceName;
    this.batchSize = config.batchSize || this.batchSize;
    this.flushInterval = config.flushInterval || this.flushInterval;
    
    this.startBatchTimer();
  }
  
  async export(spans: Span[]): Promise<void> {
    this.batch.push(...spans);
    
    if (this.batch.length >= this.batchSize) {
      await this.flush();
    }
  }
  
  async flush(): Promise<void> {
    if (this.batch.length === 0) {
      return;
    }
    
    const spans = this.batch;
    this.batch = [];
    
    try {
      const jaegerSpans = spans.map(span => this.convertToJaegerSpan(span));
      
      await fetch(`${this.endpoint}/api/traces`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-thrift',
        },
        body: JSON.stringify({
          batch: {
            process: {
              serviceName: this.serviceName,
              tags: []
            },
            spans: jaegerSpans
          }
        })
      });
    } catch (error) {
      console.error('Failed to export spans to Jaeger:', error);
    }
  }
  
  async shutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
    }
    await this.flush();
  }
  
  private convertToJaegerSpan(span: Span): any {
    const spanData = (span as any).toJSON();
    return {
      traceID: spanData.context.traceId,
      spanID: spanData.context.spanId,
      operationName: spanData.attributes['span.name'] || 'unknown',
      startTime: spanData.attributes['span.startTime'] || Date.now(),
      duration: spanData.endTime ? spanData.endTime - (spanData.attributes['span.startTime'] || Date.now()) : 0,
      tags: Object.entries(spanData.attributes).map(([key, value]) => ({
        key,
        type: typeof value === 'string' ? 'string' : typeof value === 'boolean' ? 'bool' : 'float64',
        value: String(value)
      })),
      logs: spanData.events.map((event: any) => ({
        timestamp: event.timestamp,
        fields: [
          { key: 'event', value: event.name },
          ...Object.entries(event.attributes || {}).map(([k, v]) => ({
            key: k,
            value: String(v)
          }))
        ]
      }))
    };
  }
  
  private startBatchTimer(): void {
    this.timer = setInterval(() => {
      this.flush().catch(console.error);
    }, this.flushInterval);
  }
}

/**
 * Zipkin exporter
 */
export class ZipkinExporter implements TraceExporter {
  private endpoint: string;
  private serviceName: string;
  
  constructor(config: {
    endpoint: string;
    serviceName: string;
  }) {
    this.endpoint = config.endpoint;
    this.serviceName = config.serviceName;
  }
  
  async export(spans: Span[]): Promise<void> {
    const zipkinSpans = spans.map(span => this.convertToZipkinSpan(span));
    
    try {
      await fetch(`${this.endpoint}/api/v2/spans`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(zipkinSpans)
      });
    } catch (error) {
      console.error('Failed to export spans to Zipkin:', error);
    }
  }
  
  async shutdown(): Promise<void> {
    // No cleanup needed
  }
  
  private convertToZipkinSpan(span: Span): any {
    const spanData = (span as any).toJSON();
    return {
      traceId: spanData.context.traceId,
      id: spanData.context.spanId,
      name: spanData.attributes['span.name'] || 'unknown',
      timestamp: spanData.attributes['span.startTime'] || Date.now(),
      duration: spanData.endTime ? spanData.endTime - (spanData.attributes['span.startTime'] || Date.now()) : 0,
      localEndpoint: {
        serviceName: this.serviceName
      },
      tags: spanData.attributes,
      annotations: spanData.events.map((event: any) => ({
        timestamp: event.timestamp,
        value: event.name
      }))
    };
  }
}

/**
 * W3C TraceContext propagator
 */
export class W3CTraceContextPropagator implements Propagator {
  inject(context: SpanContext, carrier: any): void {
    const traceparent = `00-${context.traceId}-${context.spanId}-${context.traceFlags.toString(16).padStart(2, '0')}`;
    carrier['traceparent'] = traceparent;
    
    if (context.traceState) {
      carrier['tracestate'] = context.traceState;
    }
  }
  
  extract(carrier: any): SpanContext | null {
    const traceparent = carrier['traceparent'];
    if (!traceparent) {
      return null;
    }
    
    const parts = traceparent.split('-');
    if (parts.length !== 4) {
      return null;
    }
    
    return {
      traceId: parts[1],
      spanId: parts[2],
      traceFlags: parseInt(parts[3], 16),
      traceState: carrier['tracestate']
    };
  }
}

/**
 * Tracing plugin for Nexus container
 */
export class TracingPlugin implements Plugin {
  name = 'tracing';
  version = '1.0.0';
  
  private tracer: Tracer;
  private propagator: Propagator;
  private activeSpans = new WeakMap<ResolutionContext, Span>();
  
  constructor(config?: {
    exporter?: TraceExporter;
    propagator?: Propagator;
  }) {
    this.tracer = new SimpleTracer(config?.exporter);
    this.propagator = config?.propagator || new W3CTraceContextPropagator();
  }
  
  install(container: Container): void {
    // Register tracer in container
    container.register(TracerToken, { useValue: this.tracer });
    
    // Add hooks for automatic tracing
    this.addTracingHooks(container);
  }
  
  private addTracingHooks(container: Container): void {
    // Use lifecycle manager directly for proper event handling
    const lifecycleManager = (container as any).lifecycleManager;
    if (!lifecycleManager) return;
    
    // Before resolve hook
    lifecycleManager.on('resolve:before', (data: any) => {
      const token = data.token;
      const context = data.context;
      
      if (!token || !context || typeof context !== 'object') return;
      
      const tokenName = typeof token === 'string' ? token :
                        typeof token === 'symbol' ? token.toString() :
                        token?.name || 'unknown';
      
      const span = this.tracer.startSpan(`resolve:${tokenName}`, {
        kind: 'INTERNAL',
        attributes: {
          'token.name': tokenName,
          'container.id': (container as any).id || 'unknown'
        }
      });
      
      // Store span using the context object as key
      this.activeSpans.set(context, span);
    });
    
    // After resolve hook
    lifecycleManager.on('resolve:after', (data: any) => {
      const context = data.context;
      
      if (!context || typeof context !== 'object') return;
      
      const span = this.activeSpans.get(context);
      if (span) {
        span.setStatus({ code: 'OK' });
        span.end();
        this.activeSpans.delete(context);
      }
    });
    
    // Error hook
    lifecycleManager.on('resolve:failed', (data: any) => {
      const context = data.context;
      const error = data.error;
      
      if (!context || typeof context !== 'object') return;
      
      const span = this.activeSpans.get(context);
      if (span) {
        span.setStatus({ code: 'ERROR', message: error?.message || 'Unknown error' });
        if (error) {
          span.addEvent('error', {
            'error.type': error.constructor?.name || 'Error',
            'error.message': error.message || '',
            'error.stack': error.stack || ''
          });
        }
        span.end();
        this.activeSpans.delete(context);
      }
    });
  }
  
  /**
   * Create traced version of a function
   */
  trace<T extends (...args: any[]) => any>(
    fn: T,
    name?: string
  ): T {
    const tracer = this.tracer;
    const spanName = name || fn.name || 'anonymous';
    
    return function traced(this: any, ...args: any[]) {
      return tracer.startActiveSpan(spanName, (span) => {
        span.setAttribute('function.name', spanName);
        span.setAttribute('function.args.count', args.length);
        
        try {
          const result = fn.apply(this, args);
          
          if (result && typeof result.then === 'function') {
            // Handle promises
            return result.then(
              (value: any) => {
                span.setStatus({ code: 'OK' });
                return value;
              },
              (error: any) => {
                span.setStatus({ code: 'ERROR', message: String(error) });
                throw error;
              }
            );
          }
          
          return result;
        } catch (error) {
          span.setStatus({ code: 'ERROR', message: String(error) });
          throw error;
        }
      });
    } as T;
  }
}

/**
 * Decorator for tracing methods
 */
export function Trace(name?: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const spanName = name || `${target.constructor.name}.${propertyKey}`;
    
    descriptor.value = function (this: any, ...args: any[]) {
      // Get tracer from container if available
      const tracer = (this as any).__tracer || new SimpleTracer();
      
      return tracer.startActiveSpan(spanName, (span: Span) => {
        span.setAttribute('class.name', target.constructor.name);
        span.setAttribute('method.name', propertyKey);
        span.setAttribute('args.count', args.length);
        
        try {
          const result = originalMethod.apply(this, args);
          
          if (result && typeof result.then === 'function') {
            return result.then(
              (value: any) => {
                span.setStatus({ code: 'OK' });
                return value;
              },
              (error: any) => {
                span.setStatus({ code: 'ERROR', message: String(error) });
                throw error;
              }
            );
          }
          
          return result;
        } catch (error) {
          span.setStatus({ code: 'ERROR', message: String(error) });
          throw error;
        }
      });
    };
    
    return descriptor;
  };
}

/**
 * Create OpenTelemetry-compatible tracer provider
 */
export function createTracerProvider(config: {
  serviceName: string;
  exporter: 'jaeger' | 'zipkin' | 'console';
  endpoint?: string;
}): Tracer {
  let exporter: TraceExporter;
  
  switch (config.exporter) {
    case 'jaeger':
      exporter = new JaegerExporter({
        endpoint: config.endpoint || 'http://localhost:14268',
        serviceName: config.serviceName
      });
      break;
    
    case 'zipkin':
      exporter = new ZipkinExporter({
        endpoint: config.endpoint || 'http://localhost:9411',
        serviceName: config.serviceName
      });
      break;
    
    case 'console':
    default:
      exporter = {
        async export(spans: Span[]) {
          console.log('Exported spans:', spans);
        },
        async shutdown() {}
      };
  }
  
  return new SimpleTracer(exporter);
}

// Export tokens
export const TracerToken = createToken<Tracer>('Tracer');
export const TraceExporterToken = createToken<TraceExporter>('TraceExporter');
export const PropagatorToken = createToken<Propagator>('Propagator');