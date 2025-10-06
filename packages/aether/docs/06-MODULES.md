# Aether Module System

## Introduction

The Aether module system is inspired by Angular NgModules, but simplified and optimized for compile-time analysis and tree-shaking. Modules let you organize an application into logical, loosely coupled blocks with clear boundaries.

## Module Philosophy

### Why modules?

1. **Code organization** — Group related components, services, and assets
2. **Encapsulation** — Hide implementation details
3. **Reusability** — Reuse modules across applications
4. **Lazy Loading** — Load modules on demand
5. **DI Scoping** — Control dependency lifetimes and visibility
6. **Code Splitting** — Automatic splitting by module

### Differences from Angular Modules

| Aspect | Angular Modules | Aether Modules |
|--------|----------------|---------------|
| Declaration | @NgModule decorator | defineModule() function |
| Imports | Global, implicit | Explicit ES6 imports |
| Tree-shaking | Limited | Full |
| Compile-time analysis | Limited | Deep |
| API size | Large | Minimal |
| Metadata | Runtime | Compile-time |

## Defining a Module

### Basic Syntax

```typescript
// auth/auth.module.ts
import { defineModule } from 'aether';
import { LoginComponent } from './components/Login';
import { RegisterComponent } from './components/Register';
import { AuthService } from './services/auth.service';
import { UserService } from './services/user.service';
import { CommonModule } from '@/modules/common/common.module';

export const AuthModule = defineModule({
  // Unique module identifier
  id: 'auth',

  // Imported modules
  imports: [
    CommonModule
  ],

  // Module components
  components: [
    LoginComponent,
    RegisterComponent
  ],

  // Module services
  providers: [
    AuthService,
    UserService
  ],

  // Exported components (visible to importing modules)
  exports: [
    LoginComponent,
    RegisterComponent
  ],

  // Exported services
  exportProviders: [
    AuthService
  ]
});
```

### ModuleDefinition Interface

```typescript
interface ModuleDefinition {
  // Unique module ID (for debugging and HMR)
  id: string;

  // Imported modules
  imports?: Module[];

  // Module components
  components?: Component[];

  // Directives
  directives?: Directive[];

  // Pipes (data transforms in templates)
  pipes?: Pipe[];

  // Service providers
  providers?: Provider[];

  // Exported components
  exports?: (Component | Directive | Pipe)[];

  // Exported providers
  exportProviders?: (Provider | Type)[];

  // Bootstrap component (root module only)
  bootstrap?: Component;

  // Module metadata
  metadata?: ModuleMetadata;
}
```

## Module Types

### 1. Root Module

The only module with a bootstrap component.

```typescript
// app/app.module.ts
import { defineModule } from 'aether';
import { App } from './App';
import { RouterModule } from 'nexus/router';
import { HttpModule } from 'nexus/http';
import { AuthModule } from '@/modules/auth/auth.module';
import { DashboardModule } from '@/modules/dashboard/dashboard.module';

export const AppModule = defineModule({
  id: 'app',

  imports: [
    RouterModule.forRoot({
      mode: 'history',
      base: '/'
    }),
    HttpModule.forRoot({
      baseURL: '/api'
    }),
    AuthModule,
    DashboardModule
  ],

  components: [App],

  providers: [
    // Global singleton services
    { provide: AppConfig, useValue: config },
    { provide: ErrorHandler, useClass: GlobalErrorHandler }
  ],

  bootstrap: App
});
```

### 2. Feature Module

A module that implements a specific feature.

```typescript
// blog/blog.module.ts
import { defineModule } from 'aether';
import { BlogList } from './components/BlogList';
import { BlogPost } from './components/BlogPost';
import { BlogEditor } from './components/BlogEditor';
import { BlogService } from './services/blog.service';
import { CommentService } from './services/comment.service';
import { RouterModule } from 'nexus/router';
import { FormsModule } from '@/modules/forms/forms.module';

export const BlogModule = defineModule({
  id: 'blog',

  imports: [
    RouterModule.forChild([
      { path: '/blog', component: BlogList },
      { path: '/blog/:slug', component: BlogPost },
      { path: '/blog/edit/:slug', component: BlogEditor }
    ]),
    FormsModule
  ],

  components: [
    BlogList,
    BlogPost,
    BlogEditor
  ],

  providers: [
    BlogService,
    CommentService
  ],

  // No exports — internal usage only
  exports: [],
  exportProviders: [BlogService] // Available to other modules
});
```

### 3. Shared Module

A module with reusable components and utilities.

```typescript
// shared/shared.module.ts
import { defineModule } from 'aether';
import { Button } from './components/Button';
import { Card } from './components/Card';
import { Modal } from './components/Modal';
import { Icon } from './components/Icon';
import { DatePipe } from './pipes/date.pipe';
import { CurrencyPipe } from './pipes/currency.pipe';

export const SharedModule = defineModule({
  id: 'shared',

  components: [
    Button,
    Card,
    Modal,
    Icon
  ],

  pipes: [
    DatePipe,
    CurrencyPipe
  ],

  // Export everything for use in other modules
  exports: [
    Button,
    Card,
    Modal,
    Icon,
    DatePipe,
    CurrencyPipe
  ]
});
```

### 4. Core Module

A module with singleton services, imported once in the AppModule.

```typescript
// core/core.module.ts
import { defineModule } from 'aether';
import { AuthService } from './services/auth.service';
import { LoggerService } from './services/logger.service';
import { ConfigService } from './services/config.service';
import { HttpInterceptor } from './interceptors/http.interceptor';
import { AuthGuard } from './guards/auth.guard';

export const CoreModule = defineModule({
  id: 'core',

  providers: [
    // Singleton services
    { provide: AuthService, scope: 'singleton' },
    { provide: LoggerService, scope: 'singleton' },
    { provide: ConfigService, scope: 'singleton' },

    // Interceptors
    { provide: HTTP_INTERCEPTORS, useClass: HttpInterceptor, multi: true },

    // Guards
    AuthGuard
  ],

  exportProviders: [
    AuthService,
    LoggerService,
    ConfigService,
    AuthGuard
  ]
});

// Guard against re-import
if (import.meta.hot) {
  let imported = false;

  export const CoreModule = defineModule({
    /* ... */

    // Import-time check
    onImport() {
      if (imported) {
        throw new Error(
          'CoreModule has already been loaded. Import it only in AppModule.'
        );
      }
      imported = true;
    }
  });
}
```

## Module Configuration (forRoot/forChild pattern)

Modules can expose static methods for configuration.

### RouterModule Example

```typescript
// nexus/router/router.module.ts
import { defineModule, ModuleWithProviders } from 'aether';

export class RouterModule {
  // For the root module (singleton configuration)
  static forRoot(config: RouterConfig): ModuleWithProviders {
    return {
      module: defineModule({
        id: 'router-root',
        providers: [
          Router,
          { provide: ROUTER_CONFIG, useValue: config }
        ],
        exportProviders: [Router]
      }),
      providers: [
        { provide: ROUTER_CONFIG, useValue: config }
      ]
    };
  }

  // For feature modules (route registration)
  static forChild(routes: Route[]): ModuleWithProviders {
    return {
      module: defineModule({
        id: 'router-child',
        providers: [
          { provide: ROUTES, useValue: routes, multi: true }
        ]
      })
    };
  }
}

// Usage in AppModule
imports: [
  RouterModule.forRoot({ mode: 'history' })
]

// Usage in Feature Module
imports: [
  RouterModule.forChild([
    { path: '/blog', component: BlogList }
  ])
]
```

## Lazy Loading Modules

Modules can be loaded asynchronously.

### Defining a Lazy Module

```typescript
// dashboard/dashboard.module.ts
export const DashboardModule = defineModule({
  id: 'dashboard',

  // Mark as lazy (optional, compiler often infers)
  lazy: true,

  imports: [
    RouterModule.forChild([
      { path: '', component: DashboardHome },
      { path: 'analytics', component: Analytics },
      { path: 'settings', component: Settings }
    ])
  ],

  components: [
    DashboardHome,
    Analytics,
    Settings
  ],

  providers: [
    DashboardService,
    AnalyticsService
  ]
});
```

### Loading in the Router

```typescript
// app/app.module.ts
RouterModule.forRoot({
  routes: [
    { path: '/', component: Home },
    {
      path: '/dashboard',
      // Lazy-load module
      loadModule: () => import('@/modules/dashboard/dashboard.module')
        .then(m => m.DashboardModule)
    }
  ]
})
```

### Preloading Strategies

```typescript
// Eager — load right after initial load
{
  path: '/dashboard',
  loadModule: () => import('./dashboard.module'),
  preload: 'eager'
}

// Visible — load when the link is visible in the viewport
{
  path: '/profile',
  loadModule: () => import('./profile.module'),
  preload: 'visible'
}

// Hover — load on link hover
{
  path: '/settings',
  loadModule: () => import('./settings.module'),
  preload: 'hover'
}

// Custom — custom strategy
{
  path: '/admin',
  loadModule: () => import('./admin.module'),
  preload: (route) => userHasAdminRole()
}
```

## Dependency Injection Scopes

Modules define scopes for providers.

### Singleton Scope (default)

```typescript
export const AppModule = defineModule({
  providers: [
    // A single instance for the entire application
    { provide: AuthService, scope: 'singleton' }
  ]
});
```

### Module Scope

```typescript
export const FeatureModule = defineModule({
  providers: [
    // A new instance per module import
    { provide: FeatureService, scope: 'module' }
  ]
});
```

### Transient Scope

```typescript
export const UtilsModule = defineModule({
  providers: [
    // A new instance on each injection
    { provide: IdGenerator, scope: 'transient' }
  ]
});
```

### Request Scope (SSR)

```typescript
export const ApiModule = defineModule({
  providers: [
    // A new instance per HTTP request (SSR only)
    { provide: RequestContext, scope: 'request' }
  ]
});
```

## Module Re-exports

Modules can re-export imported modules.

```typescript
// shared/shared.module.ts
import { CommonModule } from '@/modules/common/common.module';
import { FormsModule } from '@/modules/forms/forms.module';

export const SharedModule = defineModule({
  imports: [
    CommonModule,
    FormsModule
  ],

  // Re-export imported modules
  exports: [
    CommonModule,  // Module
    FormsModule,   // Module
    Button,        // Component
    Card          // Component
  ]
});

// Importing SharedModule now exposes CommonModule and FormsModule
import { SharedModule } from '@/modules/shared/shared.module';

export const FeatureModule = defineModule({
  imports: [SharedModule], // Get CommonModule, FormsModule, Button, Card
});
```

## Barrel Exports

Modules support barrel exports for convenient imports.

```typescript
// auth/index.ts
export { AuthModule } from './auth.module';
export { AuthService } from './services/auth.service';
export { UserService } from './services/user.service';
export { LoginComponent } from './components/Login';
export { RegisterComponent } from './components/Register';

export type { User, AuthState, LoginCredentials } from './types';

// Usage
import { AuthModule, AuthService, User } from '@/modules/auth';
```

## Module Metadata

Metadata for dev tools and debugging.

```typescript
export const BlogModule = defineModule({
  metadata: {
    // Human-readable name
    name: 'Blog Module',

    // Module version
    version: '1.0.0',

    // Description
    description: 'Blog functionality including posts, comments, and categories',

    // Author
    author: 'Team Name',

    // Dependencies (for documentation)
    dependencies: [
      'RouterModule',
      'FormsModule'
    ]
  }
});
```

## Compile-Time Module Analysis

The compiler analyzes modules for optimizations.

### Tree-Shaking

```typescript
// shared.module.ts
export const SharedModule = defineModule({
  components: [
    Button,      // Used
    Card,        // Used
    Modal,       // NOT used
    Dialog,      // NOT used
    Tooltip      // Used
  ]
});

// The compiler will drop Modal and Dialog from the final bundle
// if they aren't imported anywhere
```

### Dependency Graph

```typescript
// The compiler builds a dependency graph
AppModule
  → CoreModule (singleton, eager)
  → SharedModule (eager)
  → AuthModule (eager)
  → DashboardModule (lazy)
    → ChartsModule (lazy)
    → DataModule (lazy)

// Generates chunks:
// - app.js (AppModule + CoreModule + SharedModule + AuthModule)
// - dashboard.js (DashboardModule)
// - charts.js (ChartsModule)
// - data.js (DataModule)
```

### Circular Dependency Detection

```typescript
// The compiler detects circular dependencies
ModuleA imports ModuleB
ModuleB imports ModuleC
ModuleC imports ModuleA // ❌ Circular dependency detected!

// Error:
// Circular dependency detected:
//   ModuleA → ModuleB → ModuleC → ModuleA
//
// Suggestion: Extract shared code into a new module
```

## Best Practices

### 1. Core Module Pattern

Create a CoreModule for singleton services and import it only in the AppModule.

```typescript
// ✅ Good
export const AppModule = defineModule({
  id: 'app',
  imports: [CoreModule], // Only in AppModule
  // ...
});

// ❌ Bad
export const FeatureModule = defineModule({
  id: 'feature',
  imports: [CoreModule], // DO NOT import in feature modules!
  // ...
});
```

### 2. Shared Module Pattern

Create a SharedModule for commonly used components.

```typescript
// ✅ Good: import SharedModule in all feature modules
export const FeatureModule = defineModule({
  imports: [SharedModule]
});

// ❌ Bad: import individual components
export const FeatureModule = defineModule({
  components: [Button, Card, Modal] // Duplication!
});
```

### 3. Feature Module per Route

Each major route should be a separate lazy module.

```typescript
// ✅ Good
{
  path: '/admin',
  loadModule: () => import('./admin/admin.module')
}

// ❌ Bad: everything in one module
{
  path: '/admin',
  component: AdminComponent // No lazy loading
}
```

### 4. Minimize Exports

Export only what is necessary.

```typescript
// ✅ Good: export only the public API
exports: [
  PublicComponent,
  PublicService
]

// ❌ Bad: export everything
exports: [
  PublicComponent,
  PrivateComponent,   // Should not be exported
  InternalService,    // Should not be exported
  HelperComponent     // Should not be exported
]
```

### 5. Single Responsibility per Module

A module should have one clear responsibility.

```typescript
// ✅ Good: clear responsibility
BlogModule      // Blog functionality only
CommentsModule  // Comments only
UsersModule     // Users only

// ❌ Bad: mixed responsibilities
MiscModule {
  components: [BlogPost, UserProfile, ProductCard, ...]
}
```

## Module Testing

### Unit Testing Modules

```typescript
import { createTestingModule } from 'nexus/testing';
import { BlogModule } from './blog.module';
import { BlogService } from './services/blog.service';

describe('BlogModule', () => {
  it('should provide BlogService', () => {
    const module = createTestingModule({
      imports: [BlogModule]
    });

    const blogService = module.inject(BlogService);
    expect(blogService).toBeDefined();
  });

  it('should export BlogListComponent', () => {
    const module = createTestingModule({
      imports: [BlogModule]
    });

    const component = module.getComponent('BlogList');
    expect(component).toBeDefined();
  });
});
```

### Integration Testing

```typescript
import { createTestingModule } from 'nexus/testing';
import { AppModule } from './app.module';
import { AuthService } from '@/core/services/auth.service';

describe('App Integration', () => {
  it('should bootstrap application', async () => {
    const module = createTestingModule({
      imports: [AppModule]
    });

    await module.bootstrap();

    const auth = module.inject(AuthService);
    expect(auth).toBeDefined();
  });
});
```

## Advanced Patterns

### Dynamic Module Loading

```typescript
// Load modules based on conditions
async function loadModule(featureName: string) {
  const moduleMap = {
    'blog': () => import('./blog/blog.module'),
    'shop': () => import('./shop/shop.module'),
    'forum': () => import('./forum/forum.module')
  };

  const loader = moduleMap[featureName];
  if (!loader) throw new Error(`Unknown feature: ${featureName}`);

  const { default: FeatureModule } = await loader();
  return FeatureModule;
}

// Usage
const BlogModule = await loadModule('blog');
```

### Plugin Architecture

```typescript
// plugin.interface.ts
export interface Plugin {
  name: string;
  module: Module;
  initialize(): void | Promise<void>;
}

// app.module.ts
export const AppModule = defineModule({
  providers: [
    {
      provide: PLUGINS,
      useValue: [
        { name: 'analytics', module: AnalyticsModule, initialize: () => {} },
        { name: 'ab-testing', module: ABTestModule, initialize: () => {} }
      ],
      multi: true
    }
  ]
});
```

## Conclusion

The Aether module system provides:

- ✅ **Organization**: Clear code structure
- ✅ **Performance**: Lazy loading and code splitting
- ✅ **Scalability**: Easy to add new functionality
- ✅ **Reusability**: Use modules across projects
- ✅ **Type Safety**: Full typing
- ✅ **Tree-Shaking**: Remove unused code
- ✅ **DX**: Excellent developer experience

Next section: [07-DEPENDENCY-INJECTION.md](./07-DEPENDENCY-INJECTION.md)
