# Aether Module Architecture Specification v2.0

> **Version**: 2.0.0
> **Status**: Specification
> **Created**: 2025-10-14
> **Authors**: Aether Team

## Executive Summary

This specification redefines Aether's module system as the **central architectural pattern** for building scalable, maintainable, and highly optimized frontend applications. Modules become the primary unit of code organization, dependency management, and optimization boundaries.

### Core Philosophy

1. **Modules are containers** - They encapsulate all related functionality
2. **Everything is a module** - From single components to entire features
3. **Modules define boundaries** - For code splitting, lazy loading, and optimization
4. **Modules manage lifecycle** - Initialization, dependencies, and cleanup
5. **Modules enable optimization** - Compile-time analysis and tree-shaking

---

## 1. Module Definition

### 1.1 Core Module Interface

```typescript
interface ModuleDefinition<T extends ModuleMetadata = ModuleMetadata> {
  // Identity
  id: string;                           // Unique module identifier
  version?: string;                     // Semantic version

  // Dependencies
  imports?: Module[];                   // Module dependencies

  // Services & Stores
  providers?: Provider[];               // Service providers
  stores?: StoreFactory[];             // Store factories

  // Routes
  routes?: RouteDefinition[];          // Module routes

  // Assets
  styles?: string[] | (() => Promise<string[]>);  // CSS imports
  assets?: AssetDefinition[];          // Static assets

  // Islands & Hydration
  islands?: IslandDefinition[];        // Interactive islands

  // Exports
  exports?: ExportDefinition;          // Public API

  // Lifecycle
  setup?: ModuleSetup<T>;              // Setup function
  teardown?: ModuleTeardown;           // Cleanup function

  // Metadata
  metadata?: T;                        // Custom metadata

  // Optimization hints
  optimization?: OptimizationHints;    // Compiler hints
}
```

### 1.2 Module Types

```typescript
type Module =
  | StaticModule      // Compile-time known
  | DynamicModule     // Runtime created
  | LazyModule        // Lazy loaded
  | RemoteModule;     // Module federation

interface StaticModule {
  type: 'static';
  definition: ModuleDefinition;
}

interface DynamicModule {
  type: 'dynamic';
  factory: () => ModuleDefinition | Promise<ModuleDefinition>;
}

interface LazyModule {
  type: 'lazy';
  load: () => Promise<Module>;
  preload?: PreloadStrategy;
}

interface RemoteModule {
  type: 'remote';
  url: string;
  fallback?: Module;
}
```

---

## 2. Module Composition

### 2.1 Basic Module

```typescript
// Simple feature module
export const TodoModule = defineModule({
  id: 'todos',

  // Dependencies
  imports: [CommonModule],

  // Services
  providers: [
    TodoService,
    { provide: TODO_API_URL, useValue: '/api/todos' }
  ],

  // Stores
  stores: [
    () => defineTodoStore()
  ],

  // Routes
  routes: [
    {
      path: '/todos',
      component: () => import('./TodoList'),
      children: [
        { path: ':id', component: () => import('./TodoDetail') }
      ]
    }
  ],

  // Styles
  styles: () => import('./todos.module.css'),

  // Setup
  setup: async ({ container, router, stores }) => {
    // Initialize module
    const todoService = container.get(TodoService);
    await todoService.initialize();

    // Return module context
    return { todoService };
  }
});
```

### 2.2 Root Module

```typescript
// Application root module
export const AppModule = defineModule({
  id: 'app',
  version: '1.0.0',

  imports: [
    // Core modules
    CoreModule,
    RouterModule.forRoot(routes),
    StoreModule.forRoot(),

    // Feature modules
    AuthModule,
    TodoModule,

    // Lazy modules
    lazy(() => import('./admin/AdminModule')),
  ],

  // Global providers
  providers: [
    { provide: API_BASE_URL, useValue: import.meta.env.VITE_API_URL },
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
  ],

  // Global stores
  stores: [
    () => defineAppStore()
  ],

  // Root setup
  setup: async ({ container }) => {
    // Global initialization
    const errorHandler = container.get(ErrorHandler);
    errorHandler.install();
  },

  // Optimization
  optimization: {
    preloadModules: ['auth', 'core'],
    prefetchModules: ['todos'],
    lazyBoundary: true,
  }
});
```

---

## 3. Module Features

### 3.1 Service Providers

Modules define and scope service providers using the existing DI system:

```typescript
export const DataModule = defineModule({
  id: 'data',

  providers: [
    // Class provider
    HttpClient,

    // Factory provider
    {
      provide: CacheManager,
      useFactory: (config: Config) => new CacheManager(config),
      deps: [Config]
    },

    // Value provider
    {
      provide: API_TIMEOUT,
      useValue: 30000
    },

    // Multi provider
    {
      provide: HTTP_INTERCEPTORS,
      useClass: AuthInterceptor,
      multi: true
    }
  ],

  // Export specific providers
  exports: {
    providers: [HttpClient, CacheManager]
  }
});
```

### 3.2 Store Integration

Modules manage store lifecycle and scoping:

```typescript
export const UserModule = defineModule({
  id: 'user',

  stores: [
    // Store factory
    () => defineStore('user', (netron) => {
      const users = signal<User[]>([]);
      const loading = signal(false);

      const loadUsers = async () => {
        loading.set(true);
        const service = await netron.service<IUserService>('users');
        users.set(await service.getUsers());
        loading.set(false);
      };

      return { users, loading, loadUsers };
    }),

    // Store with module scope
    () => defineStore('profile', {
      scope: 'module',  // New instance per module
      factory: (netron) => {
        // ...
      }
    })
  ],

  exports: {
    stores: ['user']  // Export for other modules
  }
});
```

### 3.3 Routing Integration

Modules define their routes with automatic code splitting:

```typescript
export const BlogModule = defineModule({
  id: 'blog',

  routes: [
    {
      path: '/blog',
      component: () => import('./BlogLayout'),

      // Data loading
      loader: ({ params, container }) => {
        const blogService = container.get(BlogService);
        return blogService.getPosts();
      },

      children: [
        {
          path: '',
          component: () => import('./PostList'),
        },
        {
          path: ':slug',
          component: () => import('./PostDetail'),
          loader: ({ params, container }) => {
            const blogService = container.get(BlogService);
            return blogService.getPost(params.slug);
          }
        }
      ]
    }
  ],

  // Route guards at module level
  setup: ({ router }) => {
    router.beforeEnter('/blog/*', (to, from) => {
      // Check access
    });
  }
});
```

### 3.4 Islands Architecture

Modules define their interactive islands:

```typescript
export const InteractiveModule = defineModule({
  id: 'interactive',

  islands: [
    {
      id: 'search-bar',
      component: () => import('./SearchBar'),
      strategy: 'interaction',  // Hydrate on first interaction
      props: { placeholder: 'Search...' }
    },
    {
      id: 'user-menu',
      component: () => import('./UserMenu'),
      strategy: 'visible',     // Hydrate when visible
      rootMargin: '50px'
    },
    {
      id: 'chat-widget',
      component: () => import('./ChatWidget'),
      strategy: 'idle',        // Hydrate when idle
      timeout: 2000
    }
  ],

  // Island-specific stores
  stores: [
    () => defineIslandStore('search', {
      scope: 'island',  // Scoped to island instance
      factory: () => {
        const query = signal('');
        return { query };
      }
    })
  ]
});
```

### 3.5 SSR/SSG Configuration

Modules can define rendering strategies:

```typescript
export const StaticModule = defineModule({
  id: 'static',

  routes: [
    {
      path: '/about',
      component: () => import('./About'),

      // Static generation
      rendering: 'static',

      // ISR configuration
      revalidate: 3600,  // Revalidate every hour
    },
    {
      path: '/products/:id',
      component: () => import('./Product'),

      // SSR with caching
      rendering: 'server',
      cache: {
        maxAge: 300,
        swr: 3600
      },

      // Generate static paths
      staticPaths: async () => {
        const products = await getProducts();
        return {
          paths: products.map(p => `/products/${p.id}`),
          fallback: 'blocking'
        };
      }
    }
  ]
});
```

### 3.6 Assets and Styles

Modules manage their assets:

```typescript
export const UIModule = defineModule({
  id: 'ui',

  // CSS Modules
  styles: async () => {
    const styles = await import('./styles.module.css');
    return [styles.default];
  },

  // Critical CSS
  criticalStyles: () => import('./critical.css'),

  // Static assets
  assets: [
    {
      type: 'font',
      src: './fonts/inter.woff2',
      preload: true
    },
    {
      type: 'image',
      src: './logo.svg',
      eager: true
    }
  ],

  // Theme configuration
  metadata: {
    theme: {
      primary: '#007bff',
      secondary: '#6c757d'
    }
  }
});
```

---

## 4. Module Lifecycle

### 4.1 Lifecycle Phases

```typescript
interface ModuleLifecycle {
  // Phase 1: Registration
  register?: (context: RegisterContext) => void | Promise<void>;

  // Phase 2: Setup (after dependencies loaded)
  setup?: (context: SetupContext) => ModuleContext | Promise<ModuleContext>;

  // Phase 3: Ready (after setup complete)
  ready?: (context: ReadyContext) => void | Promise<void>;

  // Phase 4: Teardown (cleanup)
  teardown?: (context: TeardownContext) => void | Promise<void>;
}

interface SetupContext {
  container: DIContainer;       // Module's DI container
  router: Router;               // Router instance
  stores: StoreManager;         // Store manager
  config: ModuleConfig;         // Module configuration
  parent?: ModuleContext;       // Parent module context
}

interface ModuleContext {
  [key: string]: any;  // Module can expose any context
}
```

### 4.2 Lifecycle Example

```typescript
export const FeatureModule = defineModule({
  id: 'feature',

  // Registration phase
  register: async ({ container }) => {
    // Register module-specific services early
    container.register(FeatureConfig, {
      useFactory: async () => {
        const config = await fetch('/api/feature-config');
        return config.json();
      }
    });
  },

  // Setup phase
  setup: async ({ container, router, stores }) => {
    // Initialize module
    const config = await container.get(FeatureConfig);
    const service = container.get(FeatureService);

    await service.initialize(config);

    // Setup route guards
    router.beforeEnter('/feature/*', async (to) => {
      if (!service.isEnabled()) {
        return '/disabled';
      }
    });

    // Initialize stores
    const featureStore = stores.get('feature');
    await featureStore.load();

    // Return context for child modules
    return {
      featureService: service,
      featureConfig: config
    };
  },

  // Ready phase
  ready: async ({ stores }) => {
    // Module fully initialized
    console.log('Feature module ready');

    // Start background tasks
    stores.get('feature').startPolling();
  },

  // Cleanup phase
  teardown: async ({ stores }) => {
    // Stop background tasks
    stores.get('feature').stopPolling();

    // Cleanup resources
    await cleanup();
  }
});
```

---

## 5. Module Resolution

### 5.1 Import Resolution

```typescript
// Static imports - resolved at compile time
imports: [CoreModule, SharedModule]

// Dynamic imports - resolved at runtime
imports: [
  () => import('./LazyModule'),
  async () => {
    const module = await import('./ConditionalModule');
    return module.default;
  }
]

// Conditional imports
imports: [
  ...(isDevelopment ? [DevToolsModule] : []),
  ...(hasFeatureFlag('analytics') ? [AnalyticsModule] : [])
]

// Remote imports (module federation)
imports: [
  remote('http://cdn.example.com/modules/shared.js')
]
```

### 5.2 Dependency Graph

The module system builds a dependency graph for:

1. **Circular dependency detection**
2. **Optimal load order**
3. **Tree shaking boundaries**
4. **Code splitting points**

```typescript
interface ModuleGraph {
  nodes: Map<string, ModuleNode>;
  edges: Map<string, Set<string>>;

  // Analysis
  findCircularDependencies(): string[][];
  getLoadOrder(): string[];
  getSharedDependencies(): Map<string, string[]>;
  getSplitPoints(): SplitPoint[];
}
```

---

## 6. Module Exports

### 6.1 Export Definition

```typescript
interface ExportDefinition {
  // Service providers to export
  providers?: (Provider | InjectionToken)[];

  // Stores to export
  stores?: string[];

  // Routes to merge
  routes?: RouteDefinition[];

  // Re-export other modules
  modules?: Module[];

  // Public API (for external consumption)
  api?: {
    [key: string]: any;
  };
}
```

### 6.2 Export Examples

```typescript
export const SharedModule = defineModule({
  id: 'shared',

  providers: [
    LoggerService,
    CacheService,
    ValidationService
  ],

  stores: [
    () => defineSharedStore()
  ],

  exports: {
    // Export specific providers
    providers: [LoggerService, CacheService],

    // Export all stores
    stores: ['shared'],

    // Public API
    api: {
      log: (message: string) => inject(LoggerService).log(message),
      cache: {
        get: (key: string) => inject(CacheService).get(key),
        set: (key: string, value: any) => inject(CacheService).set(key, value)
      }
    }
  }
});

// Usage in other modules
export const ConsumerModule = defineModule({
  id: 'consumer',
  imports: [SharedModule],

  setup: ({ container }) => {
    // Can use exported providers
    const logger = container.get(LoggerService);
    logger.log('Module initialized');
  }
});
```

---

## 7. Optimization

### 7.1 Compile-Time Optimization

Modules provide optimization boundaries:

```typescript
interface OptimizationHints {
  // Preload strategy
  preloadModules?: string[];        // Preload these module IDs
  prefetchModules?: string[];       // Prefetch these module IDs

  // Bundle strategy
  lazyBoundary?: boolean;           // This module is a lazy boundary
  splitChunk?: boolean;             // Force separate chunk
  inline?: boolean;                 // Inline into parent

  // Tree shaking
  sideEffects?: boolean;            // Has side effects
  pure?: boolean;                   // Pure module (can be eliminated if unused)

  // Performance
  priority?: 'high' | 'normal' | 'low';  // Loading priority
  budget?: {
    maxSize?: number;               // Max bundle size in bytes
    maxAsyncRequests?: number;      // Max parallel requests
  };
}
```

### 7.2 Tree Shaking

Modules enable aggressive tree shaking:

```typescript
// Module exports define public API
export const LibraryModule = defineModule({
  id: 'library',

  providers: [
    ServiceA,  // Used internally
    ServiceB,  // Used internally
    ServiceC   // Exported
  ],

  exports: {
    providers: [ServiceC]  // Only ServiceC is kept if module imported
  },

  optimization: {
    pure: true,  // Module can be eliminated if exports unused
    sideEffects: false
  }
});
```

### 7.3 Code Splitting

Automatic code splitting at module boundaries:

```typescript
// Compiler analyzes module imports
const moduleGraph = analyzeModules(AppModule);

// Generate split points
const splitPoints = moduleGraph.getSplitPoints();
// [
//   { module: 'admin', strategy: 'lazy', size: 150000 },
//   { module: 'analytics', strategy: 'prefetch', size: 80000 }
// ]

// Generate chunks
const chunks = generateChunks(splitPoints);
// {
//   'main': ['app', 'core', 'shared'],
//   'admin': ['admin', 'admin-shared'],
//   'analytics': ['analytics']
// }
```

---

## 8. Runtime API

### 8.1 Module Manager

```typescript
class ModuleManager {
  // Module registration
  register(module: Module): void;

  // Module loading
  load(moduleId: string): Promise<LoadedModule>;
  loadAll(moduleIds: string[]): Promise<LoadedModule[]>;

  // Module access
  get(moduleId: string): LoadedModule | undefined;
  has(moduleId: string): boolean;

  // Module lifecycle
  setup(moduleId: string): Promise<ModuleContext>;
  teardown(moduleId: string): Promise<void>;

  // Module graph
  getGraph(): ModuleGraph;
  getDependencies(moduleId: string): string[];
  getDependents(moduleId: string): string[];
}
```

### 8.2 Dynamic Module Loading

```typescript
// Lazy load module on demand
async function loadFeature() {
  const module = await moduleManager.load('feature');
  await module.setup();

  // Use module
  const service = module.container.get(FeatureService);
  return service.getData();
}

// Conditional module loading
async function loadConditionalModule(condition: boolean) {
  if (condition) {
    const module = await import('./OptionalModule');
    moduleManager.register(module.default);
    await moduleManager.setup('optional');
  }
}
```

### 8.3 Module Context API

```typescript
// Access module context
function useModule<T extends ModuleContext>(moduleId: string): T {
  const manager = inject(ModuleManager);
  const module = manager.get(moduleId);

  if (!module) {
    throw new Error(`Module ${moduleId} not loaded`);
  }

  return module.context as T;
}

// Usage
function MyComponent() {
  const { featureService } = useModule<FeatureContext>('feature');
  const data = featureService.getData();

  return <div>{data}</div>;
}
```

---

## 9. Testing

### 9.1 Module Testing

```typescript
import { createTestModule, TestModuleBuilder } from '@aether/testing';

describe('FeatureModule', () => {
  let module: TestModule;

  beforeEach(() => {
    module = new TestModuleBuilder()
      .withModule(FeatureModule)
      .withMockProvider(ApiService, MockApiService)
      .withMockStore('feature', mockFeatureStore)
      .build();
  });

  it('should initialize services', async () => {
    await module.setup();

    const service = module.get(FeatureService);
    expect(service).toBeDefined();
    expect(service.isInitialized()).toBe(true);
  });

  it('should handle routes', async () => {
    const router = module.getRouter();
    await router.navigate('/feature');

    expect(router.currentRoute).toBe('/feature');
  });
});
```

### 9.2 Integration Testing

```typescript
describe('Module Integration', () => {
  it('should load modules in correct order', async () => {
    const app = createTestApp({
      modules: [CoreModule, FeatureModule, UIModule]
    });

    await app.bootstrap();

    const loadOrder = app.getModuleLoadOrder();
    expect(loadOrder).toEqual(['core', 'feature', 'ui']);
  });

  it('should share providers between modules', async () => {
    const app = createTestApp({
      modules: [SharedModule, ConsumerModule]
    });

    await app.bootstrap();

    const sharedLogger = app.getModule('shared').get(LoggerService);
    const consumerLogger = app.getModule('consumer').get(LoggerService);

    expect(sharedLogger).toBe(consumerLogger);  // Same instance
  });
});
```

---

## 10. Migration Strategy

### 10.1 Incremental Adoption

Modules can be adopted incrementally:

```typescript
// Step 1: Wrap existing code in a module
export const LegacyModule = defineModule({
  id: 'legacy',
  setup: () => {
    // Existing initialization code
    initializeLegacyApp();
  }
});

// Step 2: Gradually move to module patterns
export const LegacyModule = defineModule({
  id: 'legacy',
  providers: [LegacyService],
  routes: legacyRoutes,
  stores: [legacyStore]
});

// Step 3: Split into feature modules
export const AppModule = defineModule({
  id: 'app',
  imports: [
    UserModule,     // Extracted from legacy
    ProductModule,  // Extracted from legacy
    LegacyModule    // Remaining legacy code
  ]
});
```

### 10.2 Compatibility

Modules are compatible with existing Aether features:

```typescript
// Works with existing routing
const routes = extractRoutes(AppModule);
createRouter(routes);

// Works with existing stores
const stores = extractStores(AppModule);
stores.forEach(store => registerStore(store));

// Works with existing DI
const container = compileModule(AppModule);
const service = container.get(MyService);
```

---

## 11. Best Practices

### 11.1 Module Structure

```
src/
├── modules/
│   ├── core/
│   │   ├── index.ts          # Module definition
│   │   ├── services/         # Module services
│   │   ├── stores/           # Module stores
│   │   ├── components/       # Module components
│   │   └── routes/           # Module routes
│   ├── feature/
│   │   ├── index.ts
│   │   ├── feature.module.ts # Alternative naming
│   │   └── ...
│   └── shared/
│       └── ...
```

### 11.2 Module Guidelines

1. **Single Responsibility**: Each module should have a clear, focused purpose
2. **Explicit Dependencies**: Declare all dependencies in imports
3. **Minimal Exports**: Only export what other modules need
4. **Lazy by Default**: Make feature modules lazy-loadable
5. **Test in Isolation**: Each module should be independently testable

### 11.3 Performance Guidelines

1. **Use lazy boundaries**: Mark clear lazy-loading boundaries
2. **Optimize bundle size**: Set size budgets per module
3. **Preload critical**: Preload critical user paths
4. **Monitor metrics**: Track module load times and sizes

---

## 12. Implementation Roadmap

### Phase 1: Core Infrastructure (Week 1)
- [ ] Enhance ModuleDefinition interface
- [ ] Implement ModuleManager runtime
- [ ] Add module lifecycle support
- [ ] Integrate with existing DI

### Phase 2: Feature Integration (Week 2)
- [ ] Store-module integration
- [ ] Route-module integration
- [ ] Island-module integration
- [ ] Asset management

### Phase 3: Optimization (Week 3)
- [ ] Compiler module analysis
- [ ] Tree shaking integration
- [ ] Code splitting at boundaries
- [ ] Bundle optimization

### Phase 4: Developer Experience (Week 4)
- [ ] Module testing utilities
- [ ] DevTools integration
- [ ] Documentation
- [ ] Migration guides

---

## Conclusion

This module architecture makes modules the **heart of every Aether application**, providing:

1. **Clear boundaries** for code organization and optimization
2. **Unified lifecycle** for all application features
3. **Optimal performance** through compile-time analysis
4. **Maximum flexibility** while maintaining simplicity
5. **Progressive enhancement** from simple to complex applications

The architecture integrates seamlessly with existing Aether features while enabling new optimization opportunities that weren't possible before.