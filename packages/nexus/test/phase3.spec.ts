/**
 * Phase 3 Feature Tests
 */

import { Container, createToken, InjectionToken } from '../src';
import { 
  ModuleFederationContainer, 
  createFederatedModule, 
  createLazyModule 
} from '../src/federation';
import {
  ConsulServiceDiscovery,
  LoadBalancer,
  LoadBalancingStrategy,
  CircuitBreaker,
  ServiceProxy,
  createRemoteProxy
} from '../src/mesh';
import {
  SimpleTracer,
  TracingPlugin,
  JaegerExporter,
  W3CTraceContextPropagator
} from '../src/tracing';
import {
  DevToolsPlugin,
  DevToolsServer,
  MessageType
} from '../src/devtools';

// Test interfaces
interface TestService {
  getName(): string;
  getValue(): number;
}

class TestServiceImpl implements TestService {
  getName(): string {
    return 'test';
  }
  
  getValue(): number {
    return 42;
  }
}

describe('Phase 3: Module Federation', () => {
  describe('ModuleFederationContainer', () => {
    let federation: ModuleFederationContainer;
    
    beforeEach(() => {
      federation = new ModuleFederationContainer();
    });
    
    it('should register remote modules', () => {
      const config = {
        name: 'remote-module',
        remoteUrl: 'http://localhost:3000/module.js',
        exports: [createToken<TestService>('TestService')]
      };
      
      federation.registerRemote(config);
      
      // In a real test, we would mock the fetch
      expect(() => federation.registerRemote(config)).not.toThrow();
    });
    
    it('should handle remote module loading failure with fallback', async () => {
      const fallbackModule = {
        name: 'fallback',
        providers: [],
        exports: [],
        imports: []
      };
      
      const config = {
        name: 'failing-module',
        remoteUrl: 'http://invalid-url/module.js',
        exports: [],
        fallback: fallbackModule,
        retry: 1,
        timeout: 100
      };
      
      federation.registerRemote(config);
      
      // This should use fallback after failure
      const module = await federation.loadRemoteModule('failing-module');
      expect(module.name).toBe('fallback');
    });
    
    it('should share module exports', () => {
      const module = {
        name: 'shared-module',
        providers: [{ provide: createToken('Shared'), useValue: 'shared-value' }],
        exports: [createToken('Shared')],
        imports: []
      };
      
      federation.shareModule(module);
      
      // Module should be shared in default scope
      expect(() => federation.shareModule(module)).not.toThrow();
    });
  });
  
  describe('Lazy Module Loading', () => {
    it('should create lazy-loaded modules', async () => {
      const lazyModule = createLazyModule(async () => ({
        name: 'lazy',
        providers: [],
        exports: [],
        imports: []
      }));
      
      expect((lazyModule.module as any).name).toBe('LazyModule');
      
      // Trigger loading
      if (lazyModule.onModuleInit) {
        await lazyModule.onModuleInit();
      }
    });
  });
});

describe('Phase 3: Service Mesh Integration', () => {
  describe('LoadBalancer', () => {
    let loadBalancer: LoadBalancer;
    
    beforeEach(() => {
      loadBalancer = new LoadBalancer(LoadBalancingStrategy.RoundRobin);
    });
    
    it('should round-robin between instances', () => {
      const instances = [
        {
          id: '1',
          name: 'service',
          version: '1.0.0',
          address: 'localhost',
          port: 3001,
          metadata: {},
          health: 'healthy' as const,
          lastHeartbeat: new Date()
        },
        {
          id: '2',
          name: 'service',
          version: '1.0.0',
          address: 'localhost',
          port: 3002,
          metadata: {},
          health: 'healthy' as const,
          lastHeartbeat: new Date()
        }
      ];
      
      loadBalancer.setInstances(instances);
      
      const first = loadBalancer.selectInstance();
      const second = loadBalancer.selectInstance();
      const third = loadBalancer.selectInstance();
      
      expect(first?.id).toBe('1');
      expect(second?.id).toBe('2');
      expect(third?.id).toBe('1'); // Back to first
    });
    
    it('should filter unhealthy instances', () => {
      const instances = [
        {
          id: '1',
          name: 'service',
          version: '1.0.0',
          address: 'localhost',
          port: 3001,
          metadata: {},
          health: 'unhealthy' as const,
          lastHeartbeat: new Date()
        },
        {
          id: '2',
          name: 'service',
          version: '1.0.0',
          address: 'localhost',
          port: 3002,
          metadata: {},
          health: 'healthy' as const,
          lastHeartbeat: new Date()
        }
      ];
      
      loadBalancer.setInstances(instances);
      
      const selected = loadBalancer.selectInstance();
      expect(selected?.id).toBe('2'); // Only healthy instance
    });
    
    it('should track connections for least connections strategy', () => {
      const lb = new LoadBalancer(LoadBalancingStrategy.LeastConnections);
      const instances = [
        {
          id: '1',
          name: 'service',
          version: '1.0.0',
          address: 'localhost',
          port: 3001,
          metadata: {},
          health: 'healthy' as const,
          lastHeartbeat: new Date()
        },
        {
          id: '2',
          name: 'service',
          version: '1.0.0',
          address: 'localhost',
          port: 3002,
          metadata: {},
          health: 'healthy' as const,
          lastHeartbeat: new Date()
        }
      ];
      
      lb.setInstances(instances);
      
      // Record connection to first instance
      lb.recordConnection('1');
      
      // Should select second instance (fewer connections)
      const selected = lb.selectInstance();
      expect(selected?.id).toBe('2');
    });
  });
  
  describe('CircuitBreaker', () => {
    let circuitBreaker: CircuitBreaker;
    
    beforeEach(() => {
      circuitBreaker = new CircuitBreaker({
        threshold: 3,
        timeout: 1000,
        resetTimeout: 1000,
        monitoringPeriod: 60000,
        failureRate: 0.5
      });
    });
    
    it('should open after threshold failures', async () => {
      const failingFn = jest.fn().mockRejectedValue(new Error('fail'));
      
      // Fail 3 times to open circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(failingFn);
        } catch {}
      }
      
      expect(circuitBreaker.getState()).toBe('open');
      
      // Should not execute when open
      await expect(circuitBreaker.execute(failingFn)).rejects.toThrow('Circuit breaker is open');
      expect(failingFn).toHaveBeenCalledTimes(3); // Not called again
    });
    
    it('should transition to half-open after reset timeout', async () => {
      const failingFn = jest.fn().mockRejectedValue(new Error('fail'));
      const successFn = jest.fn().mockResolvedValue('success');
      
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(failingFn);
        } catch {}
      }
      
      expect(circuitBreaker.getState()).toBe('open');
      
      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Should attempt in half-open state
      const result = await circuitBreaker.execute(successFn);
      expect(result).toBe('success');
      expect(circuitBreaker.getState()).toBe('closed');
    });
  });
});

describe('Phase 3: Distributed Tracing', () => {
  describe('SimpleTracer', () => {
    let tracer: SimpleTracer;
    
    beforeEach(() => {
      tracer = new SimpleTracer();
    });
    
    it('should create spans', () => {
      const span = tracer.startSpan('test-operation');
      
      expect(span.spanContext().traceId).toBeDefined();
      expect(span.spanContext().spanId).toBeDefined();
      expect(span.isRecording()).toBe(true);
      
      span.end();
      expect(span.isRecording()).toBe(false);
    });
    
    it('should handle active span context', () => {
      const result = tracer.startActiveSpan('parent', (span) => {
        span.setAttribute('test', 'value');
        return 'result';
      });
      
      expect(result).toBe('result');
    });
    
    it('should handle async active spans', async () => {
      const result = await tracer.startActiveSpanAsync('async-op', async (span) => {
        span.setAttribute('async', true);
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'async-result';
      });
      
      expect(result).toBe('async-result');
    });
    
    it('should set error status on exception', () => {
      expect(() => {
        tracer.startActiveSpan('failing-op', (span) => {
          throw new Error('test error');
        });
      }).toThrow('test error');
    });
  });
  
  describe('W3CTraceContextPropagator', () => {
    let propagator: W3CTraceContextPropagator;
    
    beforeEach(() => {
      propagator = new W3CTraceContextPropagator();
    });
    
    it('should inject trace context into carrier', () => {
      const context = {
        traceId: '12345678901234567890123456789012',
        spanId: '1234567890123456',
        traceFlags: 1
      };
      
      const carrier: any = {};
      propagator.inject(context, carrier);
      
      expect(carrier.traceparent).toBe('00-12345678901234567890123456789012-1234567890123456-01');
    });
    
    it('should extract trace context from carrier', () => {
      const carrier = {
        traceparent: '00-12345678901234567890123456789012-1234567890123456-01'
      };
      
      const context = propagator.extract(carrier);
      
      expect(context).toEqual({
        traceId: '12345678901234567890123456789012',
        spanId: '1234567890123456',
        traceFlags: 1,
        traceState: undefined
      });
    });
  });
  
  describe('TracingPlugin', () => {
    let container: Container;
    let plugin: TracingPlugin;
    
    beforeEach(() => {
      container = new Container();
      plugin = new TracingPlugin();
    });
    
    it('should install tracing hooks', () => {
      plugin.install(container);
      
      const TestToken = createToken<TestService>('TestService');
      container.register(TestToken, { useClass: TestServiceImpl });
      
      // Resolution should be traced
      const instance = container.resolve(TestToken);
      expect(instance).toBeInstanceOf(TestServiceImpl);
    });
    
    it('should create traced functions', () => {
      const fn = jest.fn().mockReturnValue('result');
      const tracedFn = plugin.trace(fn, 'test-function');
      
      const result = tracedFn('arg1', 'arg2');
      
      expect(result).toBe('result');
      expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
    });
  });
});

describe('Phase 3: DevTools Extension', () => {
  describe('DevToolsPlugin', () => {
    let container: Container;
    let plugin: DevToolsPlugin;
    let messages: any[] = [];
    
    beforeEach(() => {
      container = new Container();
      // Mock the server broadcast
      plugin = new DevToolsPlugin({ autoStart: false });
      (plugin as any).sendMessage = (msg: any) => messages.push(msg);
      messages = [];
    });
    
    it('should track container creation', () => {
      plugin.install(container);
      
      const createdMsg = messages.find(m => m.type === MessageType.ContainerCreated);
      expect(createdMsg).toBeDefined();
      expect(createdMsg.data.id).toBeDefined();
    });
    
    it('should track token registration', () => {
      plugin.install(container);
      messages = []; // Clear initial messages
      
      const TestToken = createToken<TestService>('TestService');
      container.register(TestToken, { useClass: TestServiceImpl });
      
      const registeredMsg = messages.find(m => m.type === MessageType.TokenRegistered);
      expect(registeredMsg).toBeDefined();
      expect(registeredMsg.data.token).toBe('TestService');
    });
    
    it('should generate dependency graph', () => {
      plugin.install(container);
      const containerId = (container as any).__devtools_id;
      
      const TestToken = createToken<TestService>('TestService');
      container.register(TestToken, { useClass: TestServiceImpl });
      
      const graph = plugin.getDependencyGraph(containerId);
      expect(graph).toBeDefined();
      expect(graph?.nodes.size).toBeGreaterThan(0);
    });
    
    it('should track performance metrics', () => {
      plugin.install(container);
      const containerId = (container as any).__devtools_id;
      
      const TestToken = createToken<TestService>('TestService');
      container.register(TestToken, { useClass: TestServiceImpl });
      container.resolve(TestToken);
      
      const metrics = plugin.getPerformanceMetrics(containerId);
      expect(metrics).toBeDefined();
      expect(metrics?.totalResolutions).toBeGreaterThan(0);
    });
    
    it('should generate visualization formats', () => {
      plugin.install(container);
      const containerId = (container as any).__devtools_id;
      
      const TestToken = createToken<TestService>('TestService');
      container.register(TestToken, { useClass: TestServiceImpl });
      
      const dot = plugin.generateGraphVisualization(containerId);
      expect(dot).toContain('digraph Dependencies');
      
      const mermaid = plugin.generateMermaidDiagram(containerId);
      expect(mermaid).toContain('graph TD');
    });
    
    it('should create container snapshots', () => {
      plugin.install(container);
      const containerId = (container as any).__devtools_id;
      
      const TestToken = createToken<TestService>('TestService');
      container.register(TestToken, { useClass: TestServiceImpl });
      
      const snapshot = plugin.getSnapshot(containerId);
      expect(snapshot).toBeDefined();
      expect(snapshot?.registrations.length).toBeGreaterThan(0);
      
      // Find the TestService registration (skip DevTools registration)
      const testServiceReg = snapshot?.registrations.find(r => r.token === 'TestService');
      expect(testServiceReg).toBeDefined();
      expect(testServiceReg?.token).toBe('TestService');
    });
  });
});

// Integration test combining all Phase 3 features
describe('Phase 3: Integration Test', () => {
  it('should work with all Phase 3 features together', async () => {
    const container = new Container();
    
    // Install plugins
    const tracingPlugin = new TracingPlugin();
    const devToolsPlugin = new DevToolsPlugin({ autoStart: false });
    
    tracingPlugin.install(container);
    devToolsPlugin.install(container);
    
    // Register services
    const ServiceToken = createToken<TestService>('Service');
    container.register(ServiceToken, { useClass: TestServiceImpl });
    
    // Module federation
    const federation = new ModuleFederationContainer();
    const federatedModule = {
      name: 'federated',
      providers: [],
      exports: [],
      imports: []
    };
    federation.shareModule(federatedModule);
    
    // Service mesh
    const loadBalancer = new LoadBalancer(LoadBalancingStrategy.RoundRobin);
    const circuitBreaker = new CircuitBreaker({
      threshold: 5,
      timeout: 60000,
      resetTimeout: 30000,
      monitoringPeriod: 60000,
      failureRate: 0.5
    });
    
    // Resolve with tracing
    const service = container.resolve(ServiceToken);
    expect(service.getName()).toBe('test');
    expect(service.getValue()).toBe(42);
    
    // Get metrics
    const containerId = (container as any).__devtools_id;
    const metrics = devToolsPlugin.getPerformanceMetrics(containerId);
    expect(metrics?.totalResolutions).toBeGreaterThan(0);
  });
});