/**
 * Distributed Tracing support for Nexus DI
 * 
 * @module tracing
 * @packageDocumentation
 * 
 * Provides OpenTelemetry integration and distributed tracing capabilities
 */

import { createToken } from '../token/token.js';
import { Container } from '../container/container.js';
import { Plugin, PluginHooks } from '../plugins/plugin.js';
import { InjectionToken, ResolutionContext } from '../types/core.js';

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
 * Span status codes
 */
export enum SpanStatus {
  UNSET = 0,
  OK = 1,
  ERROR = 2
}

/**
 * Span status interface
 */
export interface SpanStatusValue {
  code: SpanStatus;
  message?: string;
}

/**
 * Span kinds
 */
export enum SpanKind {
  INTERNAL = 0,
  SERVER = 1,
  CLIENT = 2,
  PRODUCER = 3,
  CONSUMER = 4
}

/**
 * Trace flags
 */
export enum TraceFlags {
  NONE = 0x00,
  SAMPLED = 0x01
}

/**
 * Span interface
 */
export interface Span {
  readonly name: string;
  readonly spanId: string;
  readonly traceId: string;
  readonly parentId?: string;
  readonly startTime: number;
  readonly endTime?: number;
  readonly duration?: number;
  readonly attributes: SpanAttributes;
  readonly events: Array<{ name: string; timestamp: number; attributes?: SpanAttributes }>;
  readonly status?: SpanStatusValue;
  spanContext(): SpanContext;
  setAttribute(key: string, value: string | number | boolean): void;
  setAttributes(attributes: SpanAttributes): void;
  addEvent(name: string, attributes?: SpanAttributes): void;
  setStatus(status: SpanStatusValue): void;
  end(endTime?: number): void;
  isRecording(): boolean;
  getContext(): SpanContext;
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
  kind?: SpanKind;
  attributes?: SpanAttributes;
  links?: SpanLink[];
  startTime?: number;
  root?: boolean;
  parent?: Span;
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
  public readonly name: string;
  public readonly spanId: string;
  public readonly traceId: string;
  public readonly parentId?: string;
  public readonly startTime: number;
  public endTime?: number;
  public attributes: SpanAttributes = {};
  public events: Array<{ name: string; timestamp: number; attributes?: SpanAttributes }> = [];
  public status?: SpanStatusValue;
  private recording = true;
  private context: SpanContext;

  constructor(
    name: string,
    context: SpanContext,
    options?: SpanOptions,
    private exporter?: TraceExporter
  ) {
    this.name = name;
    this.context = context;
    this.spanId = context.spanId;
    this.traceId = context.traceId;
    this.parentId = options?.parent ? options.parent.spanId : undefined;
    this.startTime = options?.startTime || Date.now();

    if (options?.attributes) {
      this.attributes = { ...options.attributes };
    }

    if (options?.kind !== undefined) {
      this.setAttribute('span.kind', SpanKind[options.kind]);
    }
  }

  get duration(): number | undefined {
    if (this.endTime) {
      return this.endTime - this.startTime;
    }
    return undefined;
  }

  spanContext(): SpanContext {
    return this.context;
  }

  getContext(): SpanContext {
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

  setStatus(status: SpanStatusValue): void {
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
      name: this.name,
      spanId: this.spanId,
      traceId: this.traceId,
      parentId: this.parentId,
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.duration,
      context: this.context,
      attributes: this.attributes,
      events: this.events,
      status: this.status
    };
  }
}

/**
 * Simple tracer implementation
 */
export class SimpleTracer implements Tracer {
  private activeSpan?: Span;
  private exporter?: TraceExporter;
  private spans: Span[] = [];
  private static currentTracer?: SimpleTracer;

  constructor(exporter?: TraceExporter) {
    this.exporter = exporter;
  }

  startSpan(name: string, options?: SpanOptions): Span {
    let traceId: string;
    const parentSpan: Span | undefined = options?.parent || this.activeSpan;

    if (parentSpan) {
      traceId = parentSpan.traceId;
    } else {
      traceId = this.generateTraceId();
    }

    const context: SpanContext = {
      traceId,
      spanId: this.generateSpanId(),
      traceFlags: TraceFlags.SAMPLED
    };

    const span = new SimpleSpan(name, context, options, this.exporter);
    this.spans.push(span);

    return span;
  }

  startActiveSpan<T>(name: string, fn: (span: Span) => T): T {
    const span = this.startSpan(name);
    const previousSpan = this.activeSpan;
    this.activeSpan = span;

    try {
      const result = fn(span);
      span.setStatus({ code: SpanStatus.OK });
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatus.ERROR, message: String(error) });
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
      span.setStatus({ code: SpanStatus.OK });
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatus.ERROR, message: String(error) });
      throw error;
    } finally {
      span.end();
      this.activeSpan = previousSpan;
    }
  }

  getActiveSpan(): Span | undefined {
    return this.activeSpan;
  }

  getSpans(): Span[] {
    return [...this.spans];
  }

  clearSpans(): void {
    this.spans = [];
  }

  withSpan<T>(span: Span): T {
    const previousSpan = this.activeSpan;
    this.activeSpan = span;
    // Return a context object that includes the active span
    return { activeSpan: span } as any;
  }

  setCurrentTracer(tracer: SimpleTracer): void {
    SimpleTracer.currentTracer = tracer;
  }

  static getCurrentTracer(): SimpleTracer | undefined {
    return SimpleTracer.currentTracer;
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

      await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
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
      traceID: spanData.traceId,
      spanID: spanData.spanId,
      operationName: spanData.name || 'unknown',
      startTime: spanData.startTime * 1000, // Convert to microseconds
      duration: spanData.duration ? spanData.duration * 1000 : 0, // Convert to microseconds
      tags: Object.entries(spanData.attributes).map(([key, value]) => ({
        key,
        type: typeof value === 'string' ? 'string' : typeof value === 'boolean' ? 'bool' : 'float64',
        value: String(value)
      })),
      logs: spanData.events.map((event: any) => ({
        timestamp: event.timestamp * 1000, // Convert to microseconds
        fields: [
          { key: 'event', value: event.name },
          ...Object.entries(event.attributes || {}).map(([k, v]) => ({
            key: k,
            value: String(v)
          }))
        ]
      })),
      parentSpanID: spanData.parentId || undefined
    };
  }

  private startBatchTimer(): void {
    this.timer = setInterval(() => {
      this.flush().catch(console.error);
    }, this.flushInterval);
  }

  /**
   * Stop the batch timer and clean up resources
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
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
      // Check if endpoint already includes the path
      const url = this.endpoint.endsWith('/api/v2/spans')
        ? this.endpoint
        : `${this.endpoint}/api/v2/spans`;

      await fetch(url, {
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
      traceId: spanData.traceId,
      id: spanData.spanId,
      name: spanData.name || 'unknown',
      timestamp: spanData.startTime * 1000, // Convert to microseconds
      duration: spanData.duration ? spanData.duration * 1000 : 0, // Convert to microseconds
      localEndpoint: {
        serviceName: this.serviceName
      },
      tags: spanData.attributes,
      annotations: spanData.events.map((event: any) => ({
        timestamp: event.timestamp * 1000, // Convert to microseconds
        value: event.name
      })),
      parentId: spanData.parentId || undefined
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
  hooks?: PluginHooks;

  private tracer: Tracer;
  private propagator: Propagator;
  private activeSpans = new WeakMap<ResolutionContext, Span>();
  private spansByToken = new Map<string, Span>();

  constructor(config?: {
    tracer?: Tracer;
    exporter?: TraceExporter;
    propagator?: Propagator;
  }) {
    this.tracer = config?.tracer || new SimpleTracer(config?.exporter);
    this.propagator = config?.propagator || new W3CTraceContextPropagator();

    // Set up plugin hooks
    this.hooks = {
      beforeResolve: this.beforeResolve.bind(this),
      afterResolve: this.afterResolve.bind(this),
      onError: this.onError.bind(this)
    };
  }

  install(container: Container): void {
    // Register tracer in container
    container.register(TracerToken, { useValue: this.tracer });
  }

  /**
   * Hook methods for plugin interface
   */
  private beforeResolve<T>(token: InjectionToken<T>, context: ResolutionContext): void | Promise<void> {
    const tokenName = typeof token === 'string' ? token :
      typeof token === 'symbol' ? token.toString() :
        (token as any)?.name || 'unknown';

    // Check for trace context propagation
    let parentSpan: Span | undefined;

    // Check if traceContext was passed in resolveContext
    if (context && (context as any).resolveContext && (context as any).resolveContext.traceContext) {
      const traceContext = (context as any).resolveContext.traceContext;
      if (traceContext && (traceContext as any).activeSpan) {
        parentSpan = (traceContext as any).activeSpan;
      }
    }

    // Also check direct traceContext property
    if (!parentSpan && context && (context as any).traceContext) {
      const traceContext = (context as any).traceContext;
      if (traceContext && (traceContext as any).activeSpan) {
        parentSpan = (traceContext as any).activeSpan;
      }
    }

    const span = this.tracer.startSpan(`resolve:${tokenName}`, {
      kind: SpanKind.INTERNAL,
      parent: parentSpan,
      attributes: {
        'token.name': tokenName,
        'container.id': 'unknown'
      }
    });

    // Store span using multiple approaches - the WeakMap should work for the same context object
    this.activeSpans.set(context, span);

    // Also store by token as backup - using token's string representation as key
    const tokenKey = this.getTokenKey(token);
    this.spansByToken.set(tokenKey, span);

    // Store span directly in context for most reliable access
    (context as any).__tracingSpan = span;
  }

  private getTokenKey<T>(token: InjectionToken<T>): string {
    if (typeof token === 'string') return token;
    if (typeof token === 'symbol') return token.toString();
    if (typeof token === 'function') return token.name || 'AnonymousFunction';
    if (token && typeof token === 'object' && 'name' in token) return (token as any).name;
    return 'UnknownToken';
  }

  private afterResolve<T>(token: InjectionToken<T>, instance: T, context: ResolutionContext): void | Promise<void> {
    // Try to get span using multiple strategies
    let span = (context as any).__tracingSpan;

    if (!span) {
      span = this.activeSpans.get(context);
    }

    if (!span) {
      const tokenKey = this.getTokenKey(token);
      span = this.spansByToken.get(tokenKey);
    }

    if (span) {
      span.setStatus({ code: SpanStatus.OK });
      span.end();

      // Clean up all references
      this.activeSpans.delete(context);
      const tokenKey = this.getTokenKey(token);
      this.spansByToken.delete(tokenKey);
      delete (context as any).__tracingSpan;
    }
  }

  private onError(error: Error, token?: InjectionToken<any>, context?: ResolutionContext): void | Promise<void> {
    // Try to get span using multiple strategies
    let span: Span | undefined;

    if (context) {
      span = (context as any).__tracingSpan;

      if (!span) {
        span = this.activeSpans.get(context);
      }
    }

    if (!span && token) {
      const tokenKey = this.getTokenKey(token);
      span = this.spansByToken.get(tokenKey);
    }

    if (span) {
      span.setStatus({ code: SpanStatus.ERROR, message: error?.message || 'Unknown error' });
      span.addEvent('error', {
        'error.type': error.constructor?.name || 'Error',
        'error.message': error.message || '',
        'error.stack': error.stack || ''
      });
      span.end();

      // Clean up all references
      if (context) {
        this.activeSpans.delete(context);
        delete (context as any).__tracingSpan;
      }
      if (token) {
        const tokenKey = this.getTokenKey(token);
        this.spansByToken.delete(tokenKey);
      }
    }
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
                span.setStatus({ code: SpanStatus.OK });
                return value;
              },
              (error: any) => {
                span.setStatus({ code: SpanStatus.ERROR, message: String(error) });
                throw error;
              }
            );
          }

          return result;
        } catch (error) {
          span.setStatus({ code: SpanStatus.ERROR, message: String(error) });
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
      const tracer = (this as any).__tracer || SimpleTracer.getCurrentTracer() || new SimpleTracer();

      return tracer.startActiveSpan(spanName, (span: Span) => {
        span.setAttribute('class.name', target.constructor.name);
        span.setAttribute('method.name', propertyKey);
        span.setAttribute('args.count', args.length);

        try {
          const result = originalMethod.apply(this, args);

          if (result && typeof result.then === 'function') {
            return result.then(
              (value: any) => {
                span.setStatus({ code: SpanStatus.OK });
                return value;
              },
              (error: any) => {
                span.setStatus({ code: SpanStatus.ERROR, message: String(error) });
                throw error;
              }
            );
          }

          return result;
        } catch (error) {
          span.setStatus({ code: SpanStatus.ERROR, message: String(error) });
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
        async shutdown() { }
      };
  }

  return new SimpleTracer(exporter);
}

// Export tokens
export const TracerToken = createToken<Tracer>('Tracer');
export const TraceExporterToken = createToken<TraceExporter>('TraceExporter');
export const PropagatorToken = createToken<Propagator>('Propagator');

/**
 * Create a tracer instance
 */
export function createTracer(exporter?: TraceExporter): SimpleTracer {
  return new SimpleTracer(exporter);
}

/**
 * Execute a function within a span context
 */
export async function withSpan<T>(
  tracer: Tracer,
  name: string,
  fn: (span: Span) => Promise<T> | T
): Promise<T> {
  const span = tracer.startSpan(name);

  try {
    const result = await fn(span);
    span.setStatus({ code: SpanStatus.OK });
    return result;
  } catch (error) {
    span.setStatus({
      code: SpanStatus.ERROR,
      message: error instanceof Error ? error.message : String(error)
    });
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Decorator for tracing methods (lowercase version)
 */
export function trace(name?: string) {
  return Trace(name);
}