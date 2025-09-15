/**
 * Tracing and DevTools Tests
 * Tests for distributed tracing and developer tools integration
 */

import {
  Container,
  createToken
} from '../../src';
import {
  SimpleTracer,
  TracingPlugin,
  JaegerExporter,
  ZipkinExporter,
  W3CTraceContextPropagator,
  Span,
  SpanContext,
  SpanKind,
  SpanStatus,
  TraceFlags,
  createTracer,
  withSpan,
  trace
} from '../../src/tracing';
import {
  DevToolsPlugin,
  DevToolsServer,
  MessageType,
  ContainerSnapshot,
  DependencyGraph,
  PerformanceMetrics,
  createDevTools,
  exportToDot,
  exportToMermaid
} from '../../src/devtools';

describe('Tracing', () => {
  let container: Container;
  let tracer: SimpleTracer;

  beforeEach(() => {
    container = new Container();
    tracer = new SimpleTracer();
  });

  afterEach(async () => {
    await container.dispose();
  });

  describe('Simple Tracer', () => {
    it('should create and end spans', () => {
      const span = tracer.startSpan('test-operation');
      
      expect(span.name).toBe('test-operation');
      expect(span.startTime).toBeDefined();
      expect(span.endTime).toBeUndefined();
      
      span.end();
      
      expect(span.endTime).toBeDefined();
      expect(span.duration).toBeGreaterThanOrEqual(0);
    });

    it('should set span attributes', () => {
      const span = tracer.startSpan('test-span');
      
      span.setAttribute('user.id', '123');
      span.setAttribute('http.method', 'GET');
      span.setAttribute('http.status_code', 200);
      
      expect(span.attributes).toEqual({
        'user.id': '123',
        'http.method': 'GET',
        'http.status_code': 200
      });
    });

    it('should add span events', () => {
      const span = tracer.startSpan('test-span');
      
      span.addEvent('request_received');
      span.addEvent('processing_started', { queue_size: 10 });
      span.addEvent('processing_completed');
      
      expect(span.events).toHaveLength(3);
      expect(span.events[0].name).toBe('request_received');
      expect(span.events[1].attributes).toEqual({ queue_size: 10 });
    });

    it('should set span status', () => {
      const span = tracer.startSpan('test-span');
      
      span.setStatus({ code: SpanStatus.OK });
      expect(span.status).toEqual({ code: SpanStatus.OK });
      
      span.setStatus({ 
        code: SpanStatus.ERROR, 
        message: 'Something went wrong' 
      });
      expect(span.status).toEqual({
        code: SpanStatus.ERROR,
        message: 'Something went wrong'
      });
    });

    it('should create child spans', () => {
      const parentSpan = tracer.startSpan('parent');
      const childSpan = tracer.startSpan('child', { parent: parentSpan });
      
      expect(childSpan.parentId).toBe(parentSpan.spanId);
      expect(childSpan.traceId).toBe(parentSpan.traceId);
    });

    it('should record span hierarchy', () => {
      const root = tracer.startSpan('root');
      const child1 = tracer.startSpan('child1', { parent: root });
      const child2 = tracer.startSpan('child2', { parent: root });
      const grandchild = tracer.startSpan('grandchild', { parent: child1 });
      
      root.end();
      child1.end();
      child2.end();
      grandchild.end();
      
      const spans = tracer.getSpans();
      
      expect(spans).toHaveLength(4);
      expect(spans.find(s => s.name === 'grandchild')?.parentId)
        .toBe(spans.find(s => s.name === 'child1')?.spanId);
    });
  });

  describe('Tracing Plugin', () => {
    it('should trace container resolution', () => {
      const tracingPlugin = new TracingPlugin({ tracer });
      container.use(tracingPlugin);
      
      const token = createToken<string>('TestService');
      container.register(token, { useValue: 'test-value' });
      
      container.resolve(token);
      
      const spans = tracer.getSpans();
      expect(spans.some(s => s.name === `resolve:${token.name}`)).toBe(true);
    });

    it('should trace async resolution', async () => {
      const tracingPlugin = new TracingPlugin({ tracer });
      container.use(tracingPlugin);
      
      const token = createToken<string>('AsyncService');
      container.register(token, {
        useFactory: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return 'async-value';
        }
      });
      
      await container.resolveAsync(token);
      
      const spans = tracer.getSpans();
      console.log('Total spans:', spans.length);
      console.log('Span names:', spans.map(s => s.name));
      
      const resolveSpan = spans.find(s => s.name === `resolve:${token.name}`);
      
      // Debug output
      if (resolveSpan) {
        console.log('Span found:', {
          name: resolveSpan.name,
          startTime: resolveSpan.startTime,
          endTime: resolveSpan.endTime,
          duration: resolveSpan.duration,
          isRecording: resolveSpan.isRecording()
        });
      } else {
        console.log('No span found for:', `resolve:${token.name}`);
      }
      
      expect(resolveSpan).toBeDefined();
      if (resolveSpan) {
        expect(resolveSpan.duration).toBeGreaterThanOrEqual(10);
      }
    });

    it('should trace errors', () => {
      const tracingPlugin = new TracingPlugin({ tracer });
      container.use(tracingPlugin);
      
      const token = createToken<any>('FailingService');
      container.register(token, {
        useFactory: () => {
          throw new Error('Service initialization failed');
        }
      });
      
      try {
        container.resolve(token);
      } catch (error) {
        // Expected
      }
      
      const spans = tracer.getSpans();
      const errorSpan = spans.find(s => s.name === `resolve:${token.name}`);
      
      expect(errorSpan?.status?.code).toBe(SpanStatus.ERROR);
      expect(errorSpan?.status?.message).toContain('Service initialization failed');
    });

    it('should propagate trace context', () => {
      const tracingPlugin = new TracingPlugin({ 
        tracer,
        propagator: new W3CTraceContextPropagator()
      });
      container.use(tracingPlugin);
      
      const parentSpan = tracer.startSpan('parent-operation');
      const context = tracer.withSpan(parentSpan);
      
      const token = createToken<string>('ContextualService');
      container.register(token, { useValue: 'test' });
      
      container.resolve(token, { traceContext: context });
      
      const spans = tracer.getSpans();
      const resolveSpan = spans.find(s => s.name === `resolve:${token.name}`);
      
      expect(resolveSpan?.parentId).toBe(parentSpan.spanId);
      expect(resolveSpan?.traceId).toBe(parentSpan.traceId);
    });
  });

  describe('Trace Decorators', () => {
    it('should trace method calls with @trace decorator', async () => {
      class TestService {
        @trace('custom-operation')
        async performOperation(input: string): Promise<string> {
          await new Promise(resolve => setTimeout(resolve, 10));
          return `processed: ${input}`;
        }
        
        @trace()
        syncOperation(a: number, b: number): number {
          return a + b;
        }
      }
      
      const service = new TestService();
      tracer.setCurrentTracer(tracer);
      
      await service.performOperation('test');
      service.syncOperation(5, 3);
      
      const spans = tracer.getSpans();
      
      expect(spans.some(s => s.name === 'custom-operation')).toBe(true);
      expect(spans.some(s => s.name === 'TestService.syncOperation')).toBe(true);
    });

    it('should use withSpan helper', async () => {
      const result = await withSpan(tracer, 'wrapped-operation', async (span) => {
        span.setAttribute('custom.attribute', 'value');
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'result';
      });
      
      expect(result).toBe('result');
      
      const spans = tracer.getSpans();
      const wrappedSpan = spans.find(s => s.name === 'wrapped-operation');
      
      expect(wrappedSpan).toBeDefined();
      expect(wrappedSpan?.attributes?.['custom.attribute']).toBe('value');
    });
  });

  describe('Trace Exporters', () => {
    it('should export to Jaeger format', async () => {
      const exporter = new JaegerExporter({
        endpoint: 'http://localhost:14268/api/traces',
        serviceName: 'test-service',
        batchSize: 1
      });
      
      const span = tracer.startSpan('test-span');
      span.setAttribute('test.attribute', 'value');
      span.end();
      
      const mockFetch = jest.fn().mockResolvedValue({ ok: true });
      global.fetch = mockFetch;
      
      await exporter.export([span]);
      
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:14268/api/traces',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          }),
          body: expect.stringContaining('test-span')
        })
      );
    });

    it('should export to Zipkin format', async () => {
      const exporter = new ZipkinExporter({
        endpoint: 'http://localhost:9411/api/v2/spans'
      });
      
      const span = tracer.startSpan('zipkin-span');
      span.end();
      
      const mockFetch = jest.fn().mockResolvedValue({ ok: true });
      global.fetch = mockFetch;
      
      await exporter.export([span]);
      
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:9411/api/v2/spans',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          })
        })
      );
    });
  });

  describe('W3C Trace Context Propagation', () => {
    it('should inject and extract trace context', () => {
      const propagator = new W3CTraceContextPropagator();
      
      const span = tracer.startSpan('test');
      const carrier: Record<string, string> = {};
      
      propagator.inject(span.getContext(), carrier);
      
      expect(carrier['traceparent']).toMatch(
        /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/
      );
      
      const extractedContext = propagator.extract(carrier);
      
      expect(extractedContext?.traceId).toBe(span.traceId);
      expect(extractedContext?.spanId).toBeDefined();
    });
  });
});

describe('DevTools', () => {
  let container: Container;
  let devTools: DevToolsPlugin;

  beforeEach(() => {
    container = new Container();
    devTools = new DevToolsPlugin();
  });

  afterEach(async () => {
    await container.dispose();
    await devTools.close();
  });

  describe('DevTools Plugin', () => {
    it('should capture container events', () => {
      container.use(devTools);
      
      const token = createToken<string>('TestService');
      container.register(token, { useValue: 'test' });
      container.resolve(token);
      
      const events = devTools.getEvents();
      
      expect(events.some(e => e.type === 'register')).toBe(true);
      expect(events.some(e => e.type === 'resolve')).toBe(true);
    });

    it('should capture performance metrics', () => {
      container.use(devTools);
      
      const token = createToken<string>('Service');
      container.register(token, {
        useFactory: () => {
          // Simulate some work
          const start = Date.now();
          while (Date.now() - start < 5) {
            // Busy wait
          }
          return 'result';
        }
      });
      
      container.resolve(token);
      
      const metrics = devTools.getMetrics();
      
      expect(metrics.resolutions).toHaveLength(1);
      expect(metrics.resolutions[0].token).toBe(token.name);
      expect(metrics.resolutions[0].duration).toBeGreaterThanOrEqual(5);
    });

    it('should create container snapshot', () => {
      const token1 = createToken<string>('Service1');
      const token2 = createToken<number>('Service2');
      
      container.register(token1, { useValue: 'service1' });
      container.register(token2, { useValue: 42 });
      
      container.use(devTools);
      
      const snapshot = devTools.createSnapshot();
      
      expect(snapshot.timestamp).toBeDefined();
      expect(snapshot.registrations).toHaveLength(2);
      expect(snapshot.registrations.some(r => r.token === token1.name)).toBe(true);
      expect(snapshot.registrations.some(r => r.token === token2.name)).toBe(true);
    });

    it('should generate dependency graph', () => {
      const tokenA = createToken<any>('ServiceA');
      const tokenB = createToken<any>('ServiceB');
      const tokenC = createToken<any>('ServiceC');
      
      // Install DevTools before registering to capture registration events
      container.use(devTools);
      
      container.register(tokenA, { useValue: 'A' });
      container.register(tokenB, {
        useFactory: (a) => ({ a }),
        inject: [tokenA]
      });
      container.register(tokenC, {
        useFactory: (b) => ({ b }),
        inject: [tokenB]
      });
      
      container.resolve(tokenC);
      
      const graph = devTools.getDependencyGraph();
      
      expect(graph.nodes).toHaveLength(3);
      expect(graph.edges).toHaveLength(2);
      expect(graph.edges.some(e => 
        e.from === tokenC.name && e.to === tokenB.name
      )).toBe(true);
      expect(graph.edges.some(e => 
        e.from === tokenB.name && e.to === tokenA.name
      )).toBe(true);
    });
  });

  describe('DevTools Server', () => {
    it('should start WebSocket server', async () => {
      const server = new DevToolsServer({
        port: 9229,
        host: 'localhost'
      });
      
      await server.start();
      
      expect(server.isRunning()).toBe(true);
      expect(server.getPort()).toBe(9229);
      
      await server.stop();
    });

    it('should handle client connections', async () => {
      const server = new DevToolsServer({ port: 9230 });
      await server.start();
      
      const mockClient = {
        send: jest.fn(),
        on: jest.fn(),
        close: jest.fn()
      };
      
      server.handleConnection(mockClient as any);
      
      expect(server.getClientCount()).toBe(1);
      
      server.broadcast({
        type: MessageType.ContainerCreated,
        timestamp: Date.now(),
        containerId: 'test-container',
        data: { event: 'test' }
      });
      
      expect(mockClient.send).toHaveBeenCalled();
      
      await server.stop();
    });

    it('should handle client messages', async () => {
      const server = new DevToolsServer({ port: 9231 });
      container.use(new DevToolsPlugin({ server }));
      
      await server.start();
      
      const mockClient = {
        send: jest.fn(),
        on: jest.fn()
      };
      
      server.handleConnection(mockClient as any);
      
      // Simulate client requesting snapshot
      const messageHandler = mockClient.on.mock.calls.find(
        call => call[0] === 'message'
      )?.[1];
      
      if (messageHandler) {
        messageHandler(JSON.stringify({
          type: 'request-snapshot',
          id: '123'
        }));
      }
      
      expect(mockClient.send).toHaveBeenCalledWith(
        expect.stringContaining('snapshot')
      );
      
      await server.stop();
    });
  });

  describe('Graph Export', () => {
    it('should export dependency graph to DOT format', () => {
      const graph: DependencyGraph = {
        nodes: [
          { id: 'A', label: 'ServiceA' },
          { id: 'B', label: 'ServiceB' },
          { id: 'C', label: 'ServiceC' }
        ],
        edges: [
          { from: 'B', to: 'A' },
          { from: 'C', to: 'B' }
        ]
      };
      
      const dot = exportToDot(graph);
      
      expect(dot).toContain('digraph');
      expect(dot).toContain('ServiceA');
      expect(dot).toContain('ServiceB');
      expect(dot).toContain('ServiceC');
      expect(dot).toContain('B -> A');
      expect(dot).toContain('C -> B');
    });

    it('should export dependency graph to Mermaid format', () => {
      const graph: DependencyGraph = {
        nodes: [
          { id: 'A', label: 'ServiceA', type: 'singleton' },
          { id: 'B', label: 'ServiceB', type: 'transient' },
          { id: 'C', label: 'ServiceC', type: 'scoped' }
        ],
        edges: [
          { from: 'B', to: 'A' },
          { from: 'C', to: 'B' }
        ]
      };
      
      const mermaid = exportToMermaid(graph);
      
      expect(mermaid).toContain('graph TD');
      expect(mermaid).toContain('A[ServiceA]');
      expect(mermaid).toContain('B[ServiceB]');
      expect(mermaid).toContain('C[ServiceC]');
      expect(mermaid).toContain('B --> A');
      expect(mermaid).toContain('C --> B');
    });
  });

  describe('Performance Monitoring', () => {
    it('should track memory usage', () => {
      container.use(devTools);
      
      const initialMemory = devTools.getMemoryUsage();
      expect(initialMemory.heapUsed).toBeGreaterThan(0);
      expect(initialMemory.heapTotal).toBeGreaterThan(0);
      
      // Create some objects
      const tokens = Array.from({ length: 100 }, (_, i) => 
        createToken(`Service${i}`)
      );
      
      tokens.forEach(token => {
        container.register(token, { useValue: `value${token.name}` });
      });
      
      const afterMemory = devTools.getMemoryUsage();
      expect(afterMemory.heapUsed).toBeGreaterThanOrEqual(initialMemory.heapUsed);
    });

    it('should track resolution times', () => {
      container.use(devTools);
      
      const slowToken = createToken<string>('SlowService');
      const fastToken = createToken<string>('FastService');
      
      container.register(slowToken, {
        useFactory: () => {
          const start = Date.now();
          while (Date.now() - start < 20) {
            // Busy wait
          }
          return 'slow';
        }
      });
      
      container.register(fastToken, {
        useValue: 'fast'
      });
      
      container.resolve(slowToken);
      container.resolve(fastToken);
      
      const stats = devTools.getResolutionStats();
      
      expect(stats[slowToken.name].averageTime).toBeGreaterThanOrEqual(20);
      expect(stats[fastToken.name].averageTime).toBeLessThan(5);
    });
  });
});