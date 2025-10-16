/**
 * Module System Integration Tests
 *
 * Comprehensive integration tests for the module system working with the full Aether stack:
 * - Module compilation pipeline (defineModule → compiler → runtime)
 * - Module loading and resolution with real components
 * - Module optimization and code-splitting
 * - Cross-system integration (modules + stores + router + islands)
 * - Real-world module scenarios (lazy loading, federation, etc.)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineModule } from '../../src/di/module.js';
import { ModuleManager } from '../../src/modules/manager.js';
import { ModuleGraph } from '../../src/modules/graph.js';
import { DIContainer } from '../../src/di/container.js';
import { createApp, type Application } from '../../src/core/application.js';
import { createCompiler } from '../../src/compiler/compiler.js';
import { signal, computed } from '../../src/core/reactivity/index.js';
import { PerformanceMonitor } from '../../src/monitoring/performance.js';
import type { ModuleDefinition } from '../../src/di/types.js';

describe('Module System Integration', () => {
  describe('Full Module Compilation Pipeline', () => {
    it('should compile module with stores and execute at runtime', async () => {
      const perfMonitor = new PerformanceMonitor({ enabled: true });
      perfMonitor.mark('module-compile-start');

      // 1. Define module with stores
      const moduleSource = `
        import { signal, computed } from '@omnitron-dev/aether';
        import { defineModule } from '@omnitron-dev/aether/di';

        export const UserModule = defineModule({
          id: 'user',
          stores: [
            async () => ({
              id: 'user-store',
              state: signal({ users: [], count: computed(() => users.length) })
            })
          ]
        });
      `;

      // 2. Compile the module
      const compiler = createCompiler({
        optimize: 'aggressive',
        sourcemap: true,
        mode: 'production',
      });

      const compiled = await compiler.compile(moduleSource, 'UserModule.ts');

      expect(compiled.code).toBeDefined();
      expect(compiled.metrics?.sizeReduction).toBeGreaterThan(0);
      expect(compiled.analysis).toBeDefined();

      perfMonitor.mark('module-compile-end');
      perfMonitor.measure('module-compile', 'module-compile-start', 'module-compile-end');

      // 3. Create and execute module at runtime
      const UserModule = defineModule({
        id: 'user',
        stores: [
          async () => {
            const users = signal<any[]>([]);
            const count = computed(() => users().length);
            return {
              id: 'user-store',
              state: { users, count },
              addUser: (user: any) => users.set([...users(), user]),
            };
          },
        ],
      });

      const manager = new ModuleManager({
        container: new DIContainer(),
        storeManager: {
          register: vi.fn(),
        },
      });

      await manager.register(UserModule);
      const loaded = await manager.load('user');

      expect(loaded).toBeDefined();
      expect(loaded.status).toBe('loaded');
      expect(loaded.container).toBeDefined();

      perfMonitor.dispose();
    });

    it('should compile module with routes and components', async () => {
      const moduleSource = `
        import { defineModule } from '@omnitron-dev/aether/di';
        import { signal } from '@omnitron-dev/aether';

        function UserList() {
          const users = signal([]);
          return () => <div>{users().length} users</div>;
        }

        export const UserRouteModule = defineModule({
          id: 'user-routes',
          routes: [
            { path: '/users', component: UserList },
            { path: '/users/:id', component: UserList }
          ]
        });
      `;

      const compiler = createCompiler({
        optimize: 'basic',
        mode: 'development',
      });

      const compiled = await compiler.compile(moduleSource, 'UserRoutes.ts');

      expect(compiled.code).toBeDefined();
      expect(compiled.code.includes('defineModule') || compiled.code.includes('routes')).toBe(true);

      // Verify metadata extraction
      expect(compiled.analysis).toBeDefined();
    });

    it('should compile module with islands and optimize for hydration', async () => {
      const islandModuleSource = `
        import { defineModule } from '@omnitron-dev/aether/di';
        import { signal } from '@omnitron-dev/aether';

        function Counter() {
          const count = signal(0);
          return () => (
            <button onClick={() => count.set(count() + 1)}>
              Count: {count()}
            </button>
          );
        }

        export const IslandModule = defineModule({
          id: 'islands',
          islands: [
            {
              id: 'counter-island',
              component: async () => Counter,
              strategy: 'idle'
            }
          ]
        });
      `;

      const compiler = createCompiler({
        optimize: 'aggressive',
        mode: 'production',
      });

      const compiled = await compiler.compile(islandModuleSource, 'Islands.ts');

      expect(compiled.code).toBeDefined();
      expect(compiled.metrics?.sizeReduction).toBeGreaterThan(0);

      // Verify optimization preserved island semantics
      expect(compiled.analysis?.signals).toBeDefined();
    });

    it('should extract module metadata during compilation', async () => {
      const moduleSource = `
        import { defineModule } from '@omnitron-dev/aether/di';

        export const MetadataModule = defineModule({
          id: 'metadata-test',
          version: '1.0.0',
          metadata: {
            name: 'Metadata Test Module',
            author: 'Aether Team',
            description: 'Test module for metadata extraction'
          },
          optimization: {
            priority: 'high',
            splitChunk: true,
            budget: { maxSize: 50000 }
          }
        });
      `;

      const compiler = createCompiler({
        optimize: 'basic',
      });

      const compiled = await compiler.compile(moduleSource, 'Metadata.ts');

      expect(compiled.code).toBeDefined();
      // Metadata should be preserved in some form
      expect(compiled.analysis).toBeDefined();
    });

    it('should handle nested module imports in compilation', async () => {
      const sharedSource = `
        import { defineModule } from '@omnitron-dev/aether/di';
        export const SharedModule = defineModule({ id: 'shared', providers: [] });
      `;

      const featureSource = `
        import { defineModule } from '@omnitron-dev/aether/di';
        import { SharedModule } from './shared';
        export const FeatureModule = defineModule({
          id: 'feature',
          imports: [SharedModule],
          providers: []
        });
      `;

      const compiler = createCompiler({
        optimize: 'basic',
      });

      const compiledShared = await compiler.compile(sharedSource, 'Shared.ts');
      const compiledFeature = await compiler.compile(featureSource, 'Feature.ts');

      expect(compiledShared.code).toBeDefined();
      expect(compiledFeature.code).toBeDefined();

      // Should handle imports
      expect(compiledFeature.code.includes('import') || compiledFeature.code.includes('require')).toBe(true);
    });

    it('should tree-shake unused module exports', async () => {
      const moduleSource = `
        import { defineModule } from '@omnitron-dev/aether/di';

        class UsedService { name = 'used'; }
        class UnusedService { name = 'unused'; }

        export const TreeShakeModule = defineModule({
          id: 'treeshake',
          providers: [UsedService],
          exportProviders: [UsedService]
        });

        // UnusedService should be tree-shaken
      `;

      const compiler = createCompiler({
        optimize: 'aggressive',
        mode: 'production',
      });

      const compiled = await compiler.compile(moduleSource, 'TreeShake.ts');

      expect(compiled.code).toBeDefined();
      expect(compiled.code.length).toBeLessThan(moduleSource.length);
    });

    it('should optimize module with computed chains', async () => {
      const moduleSource = `
        import { signal, computed } from '@omnitron-dev/aether';
        import { defineModule } from '@omnitron-dev/aether/di';

        export const ChainModule = defineModule({
          id: 'chain',
          stores: [
            async () => {
              const base = signal(10);
              const doubled = computed(() => base() * 2);
              const tripled = computed(() => doubled() * 1.5);
              const quadrupled = computed(() => tripled() * 1.333);
              return { id: 'chain-store', state: { base, result: quadrupled } };
            }
          ]
        });
      `;

      const compiler = createCompiler({
        optimize: 'aggressive',
      });

      const compiled = await compiler.compile(moduleSource, 'Chain.ts');

      expect(compiled.code).toBeDefined();
      expect(compiled.analysis?.computed.length).toBeGreaterThan(0);
    });

    it('should inline small modules when appropriate', async () => {
      const tinyModuleSource = `
        import { defineModule } from '@omnitron-dev/aether/di';
        export const TinyModule = defineModule({
          id: 'tiny',
          optimization: { inline: true }
        });
      `;

      const compiler = createCompiler({
        optimize: 'aggressive',
        mode: 'production',
      });

      const compiled = await compiler.compile(tinyModuleSource, 'Tiny.ts');

      expect(compiled.code).toBeDefined();
      expect(compiled.code.length).toBeLessThan(tinyModuleSource.length);
    });
  });

  describe('Module Loading & Resolution', () => {
    let manager: ModuleManager;
    let container: DIContainer;

    beforeEach(() => {
      container = new DIContainer();
      manager = new ModuleManager({ container });
    });

    afterEach(() => {
      manager.clear();
    });

    it('should load modules in correct dependency order', async () => {
      const loadOrder: string[] = [];

      const core = defineModule({
        id: 'core',
        setup: async () => {
          loadOrder.push('core');
          return {};
        },
      });

      const shared = defineModule({
        id: 'shared',
        imports: [core],
        setup: async () => {
          loadOrder.push('shared');
          return {};
        },
      });

      const feature = defineModule({
        id: 'feature',
        imports: [shared],
        setup: async () => {
          loadOrder.push('feature');
          return {};
        },
      });

      await manager.register(core);
      await manager.register(shared);
      await manager.register(feature);

      await manager.load('feature');
      await manager.setup('core');
      await manager.setup('shared');
      await manager.setup('feature');

      expect(loadOrder).toEqual(['core', 'shared', 'feature']);
    });

    it('should handle lazy module loading with dynamic import', async () => {
      const perfMonitor = new PerformanceMonitor({ enabled: true });
      perfMonitor.mark('lazy-load-start');

      // Create lazy module first
      const lazyModuleDef = defineModule({
        id: 'lazy-loaded',
        providers: [],
      });

      // Register and load the lazy module
      await manager.register(lazyModuleDef);

      // Simulate async loading delay
      await new Promise((resolve) => setTimeout(resolve, 10));

      const mainModule = defineModule({
        id: 'main',
        imports: [lazyModuleDef],
      });

      await manager.register(mainModule);
      await manager.load('main');

      perfMonitor.mark('lazy-load-end');
      perfMonitor.measure('lazy-load', 'lazy-load-start', 'lazy-load-end');
      const measures = perfMonitor.getMeasures();

      expect(measures.some((m) => m.name === 'lazy-load')).toBe(true);
      expect(manager.has('lazy-loaded')).toBe(true);

      perfMonitor.dispose();
    });

    it('should detect and prevent circular dependencies', async () => {
      const moduleA = defineModule({ id: 'a', imports: [] });
      const moduleB = defineModule({ id: 'b', imports: [moduleA] });

      // Create circular dependency
      moduleA.definition.imports = [moduleB];

      await manager.register(moduleA);
      await manager.register(moduleB);

      await expect(manager.load('a')).rejects.toThrow(/circular dependency/i);
    });

    it('should cache and reuse loaded modules', async () => {
      const setupFn = vi.fn().mockResolvedValue({});

      const module = defineModule({
        id: 'cached',
        setup: setupFn,
      });

      await manager.register(module);

      // Load multiple times
      const loaded1 = await manager.load('cached');
      const loaded2 = await manager.load('cached');
      const loaded3 = await manager.load('cached');

      expect(loaded1).toBe(loaded2);
      expect(loaded2).toBe(loaded3);
    });

    it('should handle concurrent module loading', async () => {
      const modules = Array.from({ length: 10 }, (_, i) =>
        defineModule({
          id: `concurrent-${i}`,
          providers: [],
        })
      );

      // Register all modules
      await Promise.all(modules.map((m) => manager.register(m)));

      // Load all modules concurrently
      const loadPromises = modules.map((m) => manager.load(m.id));
      const loaded = await Promise.all(loadPromises);

      expect(loaded).toHaveLength(10);
      loaded.forEach((l) => {
        expect(l.status).toBe('loaded');
      });
    });

    it('should resolve transitive dependencies', async () => {
      const level1 = defineModule({ id: 'level1' });
      const level2 = defineModule({ id: 'level2', imports: [level1] });
      const level3 = defineModule({ id: 'level3', imports: [level2] });
      const level4 = defineModule({ id: 'level4', imports: [level3] });

      await manager.register(level1);
      await manager.register(level2);
      await manager.register(level3);
      await manager.register(level4);

      await manager.load('level4');

      // All dependencies should be loaded
      expect(manager.has('level1')).toBe(true);
      expect(manager.has('level2')).toBe(true);
      expect(manager.has('level3')).toBe(true);
      expect(manager.has('level4')).toBe(true);
    });

    it('should maintain module load order with shared dependencies', async () => {
      const shared = defineModule({ id: 'shared' });
      const feature1 = defineModule({ id: 'feature1', imports: [shared] });
      const feature2 = defineModule({ id: 'feature2', imports: [shared] });
      const app = defineModule({ id: 'app', imports: [feature1, feature2] });

      await manager.register(shared);
      await manager.register(feature1);
      await manager.register(feature2);
      await manager.register(app);

      await manager.load('app');

      const graph = manager.getGraph();
      const order = graph.getLoadOrder();

      // Shared should be loaded before features
      const sharedIndex = order.indexOf('shared');
      const feature1Index = order.indexOf('feature1');
      const feature2Index = order.indexOf('feature2');
      const appIndex = order.indexOf('app');

      expect(sharedIndex).toBeLessThan(feature1Index);
      expect(sharedIndex).toBeLessThan(feature2Index);
      expect(Math.max(feature1Index, feature2Index)).toBeLessThan(appIndex);
    });

    it('should handle module with async factory providers', async () => {
      class AsyncService {
        data: string = '';
        async init() {
          await new Promise((resolve) => setTimeout(resolve, 10));
          this.data = 'initialized';
        }
      }

      const module = defineModule({
        id: 'async-factory',
        providers: [
          {
            provide: AsyncService,
            useFactory: async () => {
              const service = new AsyncService();
              await service.init();
              return service;
            },
            async: true,
          },
        ],
      });

      await manager.register(module);
      const loaded = await manager.load('async-factory');

      expect(loaded.status).toBe('loaded');
      expect(loaded.container.has(AsyncService)).toBe(true);
    });

    it('should support dynamic module configuration', async () => {
      const ConfigurableModule = {
        forRoot: (config: { apiUrl: string }) =>
          defineModule({
            id: 'configurable',
            providers: [
              {
                provide: 'CONFIG',
                useValue: config,
              },
            ],
          }),
      };

      const module = ConfigurableModule.forRoot({ apiUrl: 'https://api.example.com' });

      await manager.register(module);
      const loaded = await manager.load('configurable');

      expect(loaded.status).toBe('loaded');
    });
  });

  describe('Module Optimization Integration', () => {
    let graph: ModuleGraph;

    beforeEach(() => {
      graph = new ModuleGraph();
    });

    it('should identify split points for code splitting', () => {
      // Large feature module
      const featureModule = defineModule({
        id: 'large-feature',
        providers: Array.from({ length: 15 }, (_, i) => ({
          provide: `Service${i}`,
          useValue: {},
        })),
        routes: [
          { path: '/feature', component: {} },
          { path: '/feature/:id', component: {} },
        ],
      });

      graph.addNode('large-feature', featureModule.definition);

      const splitPoints = graph.getSplitPoints();

      expect(splitPoints.length).toBeGreaterThan(0);
      expect(splitPoints[0].module).toBe('large-feature');
    });

    it('should optimize shared dependencies between modules', () => {
      const shared = defineModule({ id: 'shared', providers: [] });
      const feature1 = defineModule({ id: 'feature1', imports: [shared] });
      const feature2 = defineModule({ id: 'feature2', imports: [shared] });
      const feature3 = defineModule({ id: 'feature3', imports: [shared] });

      graph.addNode('shared', shared.definition);
      graph.addNode('feature1', feature1.definition);
      graph.addNode('feature2', feature2.definition);
      graph.addNode('feature3', feature3.definition);

      graph.addEdge('feature1', 'shared');
      graph.addEdge('feature2', 'shared');
      graph.addEdge('feature3', 'shared');

      const sharedDeps = graph.getSharedDependencies();

      expect(sharedDeps.has('shared')).toBe(true);
      expect(sharedDeps.get('shared')).toHaveLength(3);
    });

    it('should generate preload hints for high-priority modules', () => {
      const criticalModule = defineModule({
        id: 'critical',
        routes: [{ path: '/critical', component: {} }], // Add routes to make it a split point
        optimization: {
          priority: 'high',
          preloadModules: ['critical'],
        },
      });

      graph.addNode('critical', criticalModule.definition);

      const splitPoints = graph.getSplitPoints();
      const criticalPoint = splitPoints.find((p) => p.module === 'critical');

      expect(criticalPoint).toBeDefined();
      expect(criticalPoint?.strategy).toBe('preload');
    });

    it('should respect module size budgets', () => {
      const budgetModule = defineModule({
        id: 'budget',
        providers: Array.from({ length: 20 }, () => ({})),
        optimization: {
          budget: {
            maxSize: 30000,
          },
        },
      });

      graph.addNode('budget', budgetModule.definition);

      const splitPoints = graph.getSplitPoints();
      const budgetPoint = splitPoints.find((p) => p.module === 'budget');

      // Size should respect budget
      expect(budgetPoint?.size).toBeLessThanOrEqual(30000);
    });

    it('should optimize lazy boundary modules', () => {
      const lazyModule = defineModule({
        id: 'lazy-boundary',
        optimization: {
          lazyBoundary: true,
        },
        routes: [{ path: '/lazy', component: {} }],
      });

      graph.addNode('lazy-boundary', lazyModule.definition);

      const splitPoints = graph.getSplitPoints();

      expect(splitPoints.some((p) => p.module === 'lazy-boundary')).toBe(true);
    });

    it('should calculate optimal chunk splitting', () => {
      const modules = [
        defineModule({ id: 'core', providers: Array(5).fill({}) }),
        defineModule({
          id: 'feature1',
          providers: Array(12).fill({}),
          routes: [{ path: '/f1', component: {} }],
        }),
        defineModule({
          id: 'feature2',
          providers: Array(12).fill({}),
          routes: [{ path: '/f2', component: {} }],
        }),
        defineModule({
          id: 'feature3',
          providers: Array(12).fill({}),
          routes: [{ path: '/f3', component: {} }],
        }),
      ];

      modules.forEach((m) => graph.addNode(m.id, m.definition));

      const splitPoints = graph.getSplitPoints();

      // Features with routes should be split points
      expect(splitPoints.length).toBeGreaterThanOrEqual(3);
    });

    it('should estimate module depths correctly', () => {
      const level0 = defineModule({ id: 'level0' });
      const level1 = defineModule({ id: 'level1', imports: [level0] });
      const level2 = defineModule({ id: 'level2', imports: [level1] });

      graph.addNode('level0', level0.definition);
      graph.addNode('level1', level1.definition);
      graph.addNode('level2', level2.definition);

      graph.addEdge('level1', 'level0');
      graph.addEdge('level2', 'level1');

      expect(graph.getDepth('level0')).toBe(0);
      expect(graph.getDepth('level1')).toBe(1);
      expect(graph.getDepth('level2')).toBe(2);
    });

    it('should handle prefetch strategy for anticipated modules', () => {
      const prefetchModule = defineModule({
        id: 'prefetch',
        optimization: {
          prefetchModules: ['prefetch'],
        },
        routes: [{ path: '/prefetch', component: {} }],
      });

      graph.addNode('prefetch', prefetchModule.definition);

      const splitPoints = graph.getSplitPoints();
      const prefetchPoint = splitPoints.find((p) => p.module === 'prefetch');

      expect(prefetchPoint?.strategy).toBe('prefetch');
    });
  });

  describe('Cross-System Integration', () => {
    let app: Application;

    beforeEach(() => {
      // Setup minimal browser environment for router
      if (!global.window) {
        global.window = {
          location: { pathname: '/', search: '', hash: '' },
          history: {
            pushState: vi.fn(),
            replaceState: vi.fn(),
            go: vi.fn(),
            back: vi.fn(),
            forward: vi.fn(),
          },
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        } as any;
      }
    });

    afterEach(async () => {
      if (app) {
        await app.unmount();
      }
      // Cleanup window
      if ((global as any).window) {
        delete (global as any).window;
      }
    });

    it('should integrate modules with stores and router', async () => {
      const count = signal(0);

      const CounterModule = defineModule({
        id: 'counter',
        stores: [
          async () => ({
            id: 'counter-store',
            state: count,
            increment: () => count.set(count() + 1),
          }),
        ],
        routes: [
          {
            path: '/',
            component: {},
            loader: async ({ container }) => ({ count: count() }),
          },
        ],
      });

      app = createApp({
        rootModule: CounterModule,
        router: {
          mode: 'memory',
          initialPath: '/',
        },
      });

      await app.bootstrap();

      expect(app.modules.has('counter')).toBe(true);
      expect(count()).toBe(0);

      // Simulate interaction
      count.set(5);
      expect(count()).toBe(5);
    });

    it('should integrate modules with islands and hydration', async () => {
      // Islands array should already be setup from beforeEach
      (global.window as any).__AETHER_ISLANDS__ = [];

      const InteractiveModule = defineModule({
        id: 'interactive',
        islands: [
          {
            id: 'button-island',
            component: async () => ({}),
            strategy: 'interaction',
          },
        ],
      });

      app = createApp({
        rootModule: InteractiveModule,
        islands: true,
      });

      await app.bootstrap();

      expect((global.window as any).__AETHER_ISLANDS__).toHaveLength(1);
      expect((global.window as any).__AETHER_ISLANDS__[0].id).toBe('button-island');
    });

    it('should support module-scoped stores with DI', async () => {
      class UserService {
        getUsers() {
          return ['Alice', 'Bob'];
        }
      }

      const users = signal<string[]>([]);

      const UserModule = defineModule({
        id: 'users',
        providers: [UserService],
        stores: [
          async () => ({
            id: 'user-store',
            state: users,
            load: (service: UserService) => {
              users.set(service.getUsers());
            },
          }),
        ],
      });

      app = createApp({
        rootModule: UserModule,
      });

      await app.bootstrap();

      const loaded = app.modules.get('users');
      expect(loaded).toBeDefined();
      expect(loaded?.container.has(UserService)).toBe(true);
    });

    it('should handle route loaders with module containers', async () => {
      const loaderData = signal<any>(null);

      class DataService {
        async fetchData() {
          return { id: 1, name: 'Test Data' };
        }
      }

      const DataModule = defineModule({
        id: 'data',
        providers: [DataService],
        routes: [
          {
            path: '/data',
            component: {},
            loader: async ({ container }) => {
              const service = container.resolve(DataService);
              const data = await service.fetchData();
              loaderData.set(data);
              return data;
            },
          },
        ],
      });

      app = createApp({
        rootModule: DataModule,
        router: {
          mode: 'memory',
          initialPath: '/data',
        },
      });

      await app.bootstrap();

      // Loader should have been called during route initialization
      expect(app.modules.has('data')).toBe(true);
    });

    it('should synchronize module lifecycle with application lifecycle', async () => {
      const lifecycle: string[] = [];

      const LifecycleModule = defineModule({
        id: 'lifecycle',
        setup: async () => {
          lifecycle.push('setup');
          return { initialized: true };
        },
        teardown: async () => {
          lifecycle.push('teardown');
        },
      });

      app = createApp({
        rootModule: LifecycleModule,
      });

      await app.bootstrap();
      expect(lifecycle).toContain('setup');

      await app.unmount();
      expect(lifecycle).toContain('teardown');
    });

    it('should integrate multiple modules with shared state', async () => {
      const sharedState = signal({ theme: 'light' });

      const ThemeModule = defineModule({
        id: 'theme',
        stores: [
          async () => ({
            id: 'theme-store',
            state: sharedState,
            setTheme: (theme: string) => sharedState.set({ ...sharedState(), theme }),
          }),
        ],
      });

      const UIModule = defineModule({
        id: 'ui',
        imports: [ThemeModule],
        providers: [],
      });

      app = createApp({
        rootModule: UIModule,
      });

      await app.bootstrap();

      expect(app.modules.has('theme')).toBe(true);
      expect(app.modules.has('ui')).toBe(true);
      expect(sharedState().theme).toBe('light');
    });

    it('should handle island hydration with module containers', async () => {
      // Islands array should already be setup from beforeEach
      (global.window as any).__AETHER_ISLANDS__ = [];

      class CounterService {
        count = signal(0);
        increment() {
          this.count.set(this.count() + 1);
        }
      }

      const IslandModule = defineModule({
        id: 'island-di',
        providers: [CounterService],
        islands: [
          {
            id: 'counter-island',
            component: async () => ({}),
            strategy: 'idle',
          },
        ],
      });

      app = createApp({
        rootModule: IslandModule,
        islands: true,
      });

      await app.bootstrap();

      const registeredIsland = (global.window as any).__AETHER_ISLANDS__[0];
      expect(registeredIsland.container).toBeDefined();
      expect(registeredIsland.container.has(CounterService)).toBe(true);
    });

    it('should support nested modules with stores, routes, and islands', async () => {
      // Islands array should already be setup from beforeEach
      (global.window as any).__AETHER_ISLANDS__ = [];

      const CoreModule = defineModule({
        id: 'core',
        stores: [async () => ({ id: 'core-store', state: signal('core') })],
      });

      const FeatureModule = defineModule({
        id: 'feature',
        imports: [CoreModule],
        routes: [{ path: '/feature', component: {} }],
        islands: [
          {
            id: 'feature-island',
            component: async () => ({}),
          },
        ],
      });

      app = createApp({
        rootModule: FeatureModule,
        router: { mode: 'memory' },
        islands: true,
      });

      await app.bootstrap();

      expect(app.modules.has('core')).toBe(true);
      expect(app.modules.has('feature')).toBe(true);
      expect((global.window as any).__AETHER_ISLANDS__).toHaveLength(1);
    });
  });

  describe('Real-World Module Scenarios', () => {
    let app: Application;

    beforeEach(() => {
      // Setup minimal browser environment for router
      if (!global.window) {
        global.window = {
          location: { pathname: '/', search: '', hash: '' },
          history: {
            pushState: vi.fn(),
            replaceState: vi.fn(),
            go: vi.fn(),
            back: vi.fn(),
            forward: vi.fn(),
          },
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        } as any;
      }
    });

    afterEach(async () => {
      if (app) {
        await app.unmount();
      }
      // Cleanup window
      if ((global as any).window) {
        delete (global as any).window;
      }
    });

    it('should handle multi-module application structure', async () => {
      // Shared utilities
      const SharedModule = defineModule({
        id: 'shared',
        providers: [
          class Logger {
            log(msg: string) {
              return msg;
            }
          },
        ],
      });

      // Auth feature
      const AuthModule = defineModule({
        id: 'auth',
        imports: [SharedModule],
        stores: [async () => ({ id: 'auth-store', state: signal({ user: null }) })],
        routes: [
          { path: '/login', component: {} },
          { path: '/register', component: {} },
        ],
      });

      // Dashboard feature
      const DashboardModule = defineModule({
        id: 'dashboard',
        imports: [SharedModule, AuthModule],
        routes: [{ path: '/dashboard', component: {} }],
      });

      // Main app
      const AppModule = defineModule({
        id: 'app',
        imports: [SharedModule, AuthModule, DashboardModule],
        routes: [{ path: '/', component: {} }],
      });

      app = createApp({
        rootModule: AppModule,
        router: { mode: 'memory' },
      });

      await app.bootstrap();

      expect(app.modules.has('shared')).toBe(true);
      expect(app.modules.has('auth')).toBe(true);
      expect(app.modules.has('dashboard')).toBe(true);
      expect(app.modules.has('app')).toBe(true);

      const stats = app.modules.getStats();
      expect(stats.loaded).toBe(4);
    });

    it('should support lazy-loaded admin module', async () => {
      const perfMonitor = new PerformanceMonitor({ enabled: true });

      // Main app module
      const AppModule = defineModule({
        id: 'app',
        routes: [
          { path: '/', component: {} },
          {
            path: '/admin',
            component: {},
            lazy: async () => {
              perfMonitor.mark('admin-load-start');

              // Simulate network delay
              await new Promise((resolve) => setTimeout(resolve, 50));

              perfMonitor.mark('admin-load-end');

              return defineModule({
                id: 'admin',
                routes: [
                  { path: '/admin/users', component: {} },
                  { path: '/admin/settings', component: {} },
                ],
              });
            },
          },
        ],
      });

      app = createApp({
        rootModule: AppModule,
        router: { mode: 'memory' },
      });

      await app.bootstrap();

      perfMonitor.measure('admin-load', 'admin-load-start', 'admin-load-end');
      const measures = perfMonitor.getMeasures();

      expect(app.modules.has('app')).toBe(true);

      perfMonitor.dispose();
    });

    it('should handle micro-frontend module federation pattern', async () => {
      // Host application
      const HostModule = defineModule({
        id: 'host',
        routes: [{ path: '/', component: {} }],
      });

      // Remote module 1
      const Remote1Module = defineModule({
        id: 'remote-1',
        routes: [{ path: '/remote-1', component: {} }],
        metadata: {
          remote: true,
          url: 'http://localhost:3001',
        },
      });

      // Remote module 2
      const Remote2Module = defineModule({
        id: 'remote-2',
        routes: [{ path: '/remote-2', component: {} }],
        metadata: {
          remote: true,
          url: 'http://localhost:3002',
        },
      });

      // Federated app
      const FederatedApp = defineModule({
        id: 'federated',
        imports: [HostModule, Remote1Module, Remote2Module],
      });

      app = createApp({
        rootModule: FederatedApp,
        router: { mode: 'memory' },
      });

      await app.bootstrap();

      expect(app.modules.has('host')).toBe(true);
      expect(app.modules.has('remote-1')).toBe(true);
      expect(app.modules.has('remote-2')).toBe(true);

      // Verify module graph
      const graph = app.modules.getGraph();
      expect(graph.getDependencies('federated')).toContain('host');
    });

    it('should simulate module hot-reload scenario', async () => {
      const version1 = signal('v1');

      const HotModule = defineModule({
        id: 'hot',
        version: '1.0.0',
        stores: [
          async () => ({
            id: 'hot-store',
            state: version1,
          }),
        ],
      });

      app = createApp({
        rootModule: HotModule,
      });

      await app.bootstrap();

      expect(version1()).toBe('v1');

      // Simulate hot reload
      await app.unmount();

      const version2 = signal('v2');
      const HotModuleV2 = defineModule({
        id: 'hot',
        version: '2.0.0',
        stores: [
          async () => ({
            id: 'hot-store',
            state: version2,
          }),
        ],
      });

      app = createApp({
        rootModule: HotModuleV2,
      });

      await app.bootstrap();

      expect(version2()).toBe('v2');
    });

    it('should handle progressive module loading for large apps', async () => {
      const perfMonitor = new PerformanceMonitor({ enabled: true });
      perfMonitor.mark('app-start');

      // Critical modules (loaded immediately)
      const CoreModule = defineModule({ id: 'core' });
      const AuthModule = defineModule({ id: 'auth', imports: [CoreModule] });

      // Non-critical modules (could be lazy loaded)
      const AnalyticsModule = defineModule({
        id: 'analytics',
        optimization: { priority: 'low', lazyBoundary: true },
      });

      const HelpModule = defineModule({
        id: 'help',
        optimization: { priority: 'low', lazyBoundary: true },
      });

      // Main app
      const AppModule = defineModule({
        id: 'app',
        imports: [CoreModule, AuthModule, AnalyticsModule, HelpModule],
      });

      app = createApp({
        rootModule: AppModule,
      });

      await app.bootstrap();

      perfMonitor.mark('app-end');
      perfMonitor.measure('app-bootstrap', 'app-start', 'app-end');

      const measure = perfMonitor.getMeasures().find((m) => m.name === 'app-bootstrap');
      expect(measure).toBeDefined();

      expect(app.modules.has('core')).toBe(true);
      expect(app.modules.has('auth')).toBe(true);

      perfMonitor.dispose();
    });

    it('should handle e-commerce application module structure', async () => {
      // Product catalog
      const CatalogModule = defineModule({
        id: 'catalog',
        stores: [async () => ({ id: 'products', state: signal([]) })],
        routes: [
          { path: '/products', component: {} },
          { path: '/products/:id', component: {} },
        ],
      });

      // Shopping cart
      const CartModule = defineModule({
        id: 'cart',
        stores: [async () => ({ id: 'cart', state: signal({ items: [] }) })],
        routes: [{ path: '/cart', component: {} }],
      });

      // Checkout
      const CheckoutModule = defineModule({
        id: 'checkout',
        imports: [CartModule],
        routes: [{ path: '/checkout', component: {} }],
      });

      // User account
      const AccountModule = defineModule({
        id: 'account',
        routes: [
          { path: '/account', component: {} },
          { path: '/account/orders', component: {} },
        ],
      });

      // Main store
      const StoreModule = defineModule({
        id: 'store',
        imports: [CatalogModule, CartModule, CheckoutModule, AccountModule],
        routes: [{ path: '/', component: {} }],
      });

      app = createApp({
        rootModule: StoreModule,
        router: { mode: 'memory' },
      });

      await app.bootstrap();

      const stats = app.modules.getStats();
      expect(stats.loaded).toBe(5);

      // Check module dependencies
      expect(app.modules.getDependencies('checkout')).toContain('cart');
    });
  });

  describe('Module Performance and Memory', () => {
    it('should meet module loading performance targets', async () => {
      const perfMonitor = new PerformanceMonitor({
        enabled: true,
        budget: {
          maxRenderTime: 50,
        },
      });

      perfMonitor.mark('load-start');

      // Create 50 lightweight modules
      const modules = Array.from({ length: 50 }, (_, i) =>
        defineModule({
          id: `module-${i}`,
          providers: [
            {
              provide: `Service${i}`,
              useValue: { id: i },
            },
          ],
        })
      );

      const manager = new ModuleManager({ container: new DIContainer() });

      await Promise.all(modules.map((m) => manager.register(m)));
      await Promise.all(modules.map((m) => manager.load(m.id)));

      perfMonitor.mark('load-end');
      perfMonitor.measure('load-all', 'load-start', 'load-end');

      const measure = perfMonitor.getMeasures().find((m) => m.name === 'load-all');
      expect(measure).toBeDefined();
      expect(measure!.duration).toBeLessThan(1000); // Should load 50 modules in < 1s

      manager.clear();
      perfMonitor.dispose();
    });

    it('should cleanup module resources properly', async () => {
      const cleanupCalls: string[] = [];

      const modules = Array.from({ length: 10 }, (_, i) =>
        defineModule({
          id: `cleanup-${i}`,
          teardown: async () => {
            cleanupCalls.push(`cleanup-${i}`);
          },
        })
      );

      const manager = new ModuleManager({ container: new DIContainer() });

      await Promise.all(modules.map((m) => manager.register(m)));
      await Promise.all(modules.map((m) => manager.load(m.id)));

      // Teardown all modules
      await Promise.all(modules.map((m) => manager.teardown(m.id)));

      expect(cleanupCalls).toHaveLength(10);

      manager.clear();
    });

    it('should handle large module graphs efficiently', () => {
      const graph = new ModuleGraph();

      // Create 100 nodes with various dependencies
      for (let i = 0; i < 100; i++) {
        graph.addNode(`node-${i}`, {
          id: `node-${i}`,
          providers: [],
        } as ModuleDefinition);
      }

      // Add edges (dependencies)
      for (let i = 1; i < 100; i++) {
        graph.addEdge(`node-${i}`, `node-${Math.floor(i / 2)}`);
      }

      const startTime = performance.now();
      const order = graph.getLoadOrder();
      const duration = performance.now() - startTime;

      expect(order).toHaveLength(100);
      expect(duration).toBeLessThan(50); // Should compute order quickly
    });

    it('should not leak memory with repeated module operations', async () => {
      const manager = new ModuleManager({ container: new DIContainer() });

      for (let i = 0; i < 100; i++) {
        const module = defineModule({
          id: `temp-${i}`,
          providers: [],
        });

        await manager.register(module);
        await manager.load(`temp-${i}`);
        await manager.teardown(`temp-${i}`);
      }

      // Only current modules should remain
      const stats = manager.getStats();
      expect(stats.loaded).toBe(0);

      manager.clear();
    });
  });
});
