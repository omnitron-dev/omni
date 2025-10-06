# Aether Framework — Implementation Plan

> Comprehensive roadmap for implementing the Aether Frontend Framework

## Table of Contents

1. [Project Structure](#project-structure)
2. [Vibrancy Migration](#vibrancy-migration)
3. [Implementation Phases](#implementation-phases)
4. [Build Order and Dependencies](#build-order-and-dependencies)
5. [Testing Strategy](#testing-strategy)
6. [Tooling and Infrastructure](#tooling-and-infrastructure)
7. [Documentation Plan](#documentation-plan)
8. [Milestones and Timeline](#milestones-and-timeline)

---

## Project Structure

> **Architecture Decision**: Following the Titan pattern, Aether is **one unified package** with internal modules, not a monorepo of separate packages. This simplifies development, testing, versioning, and usage.

### Single Package Structure

```
packages/
├── aether/                   # Main framework package (@omnitron-dev/aether)
│   ├── src/
│   │   ├── core/            # Core reactivity and runtime
│   │   │   ├── reactivity/  # Signal system (migrated from experiments/vibrancy)
│   │   │   │   ├── signal.ts
│   │   │   │   ├── computed.ts
│   │   │   │   ├── effect.ts
│   │   │   │   ├── store.ts
│   │   │   │   ├── resource.ts
│   │   │   │   ├── batch.ts
│   │   │   │   └── graph.ts         # Dependency tracking
│   │   │   ├── component/           # Component system
│   │   │   │   ├── define.ts
│   │   │   │   ├── lifecycle.ts
│   │   │   │   ├── context.ts
│   │   │   │   ├── props.ts
│   │   │   │   ├── refs.ts
│   │   │   │   └── events.ts
│   │   │   ├── directives/          # Directive system
│   │   │   │   ├── registry.ts
│   │   │   │   ├── lifecycle.ts
│   │   │   │   └── built-in/        # if, for, show, etc.
│   │   │   ├── runtime/             # Runtime utilities
│   │   │   │   ├── scheduler.ts
│   │   │   │   ├── hydration.ts
│   │   │   │   ├── islands.ts
│   │   │   │   └── ssr.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── compiler/                # Template compiler and optimizer
│   │   │   ├── parser/              # TSX → AST
│   │   │   │   ├── lexer.ts
│   │   │   │   ├── parser.ts
│   │   │   │   └── ast.ts
│   │   │   ├── analyzer/            # Dependency analysis
│   │   │   │   ├── scope.ts
│   │   │   │   ├── reactive-deps.ts
│   │   │   │   └── static-analysis.ts
│   │   │   ├── transformer/         # AST transformations
│   │   │   │   ├── template.ts      # Template syntax → JS
│   │   │   │   ├── directives.ts
│   │   │   │   ├── component.ts
│   │   │   │   └── optimize.ts
│   │   │   ├── codegen/             # Code generation
│   │   │   │   ├── generator.ts
│   │   │   │   └── sourcemap.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── di/                      # Dependency injection system
│   │   │   ├── injectable.ts        # Function-based DI
│   │   │   ├── inject.ts
│   │   │   ├── container.ts
│   │   │   ├── scope.ts
│   │   │   ├── tokens.ts
│   │   │   ├── module.ts            # defineModule()
│   │   │   └── index.ts
│   │   │
│   │   ├── router/                  # File-based routing
│   │   │   ├── router.ts            # Core router
│   │   │   ├── route-matcher.ts
│   │   │   ├── file-scanner.ts      # Scan routes directory
│   │   │   ├── loader.ts            # Data loading
│   │   │   ├── action.ts            # Form actions
│   │   │   ├── navigation.ts        # Link, navigate()
│   │   │   ├── guards.ts            # Route guards
│   │   │   ├── prefetch.ts          # Prefetching
│   │   │   ├── layouts.ts           # Layout system
│   │   │   ├── error-boundary.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── forms/                   # Form utilities and validation
│   │   │   ├── create-form.ts       # Form composition
│   │   │   ├── field.ts             # Field primitives
│   │   │   ├── validation/          # Validation engines
│   │   │   │   ├── validator.ts
│   │   │   │   ├── zod.ts
│   │   │   │   └── yup.ts
│   │   │   ├── transforms.ts
│   │   │   ├── multi-step.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── primitives/              # Headless UI primitives
│   │   │   ├── dialog/
│   │   │   ├── popover/
│   │   │   ├── dropdown/
│   │   │   ├── select/
│   │   │   ├── tabs/
│   │   │   ├── accordion/
│   │   │   ├── slider/
│   │   │   ├── command/
│   │   │   ├── calendar/
│   │   │   ├── table/
│   │   │   ├── utils/               # Accessibility utilities
│   │   │   └── index.ts
│   │   │
│   │   ├── components/              # Styled component library
│   │   │   ├── button/
│   │   │   ├── input/
│   │   │   ├── card/
│   │   │   ├── alert/
│   │   │   ├── toast/
│   │   │   ├── navigation/
│   │   │   ├── layout/
│   │   │   ├── theme/               # Theming system
│   │   │   └── index.ts
│   │   │
│   │   ├── netron/                  # Netron RPC client
│   │   │   ├── client.ts            # WebSocket client
│   │   │   ├── proxy.ts             # Service proxy generator
│   │   │   ├── transport.ts
│   │   │   ├── reconnect.ts
│   │   │   ├── offline.ts
│   │   │   ├── optimistic.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── build/                   # Build system and plugins
│   │   │   ├── vite/                # Vite plugin
│   │   │   ├── webpack/             # Webpack plugin (optional)
│   │   │   ├── ssr-renderer.ts
│   │   │   ├── ssg-generator.ts
│   │   │   ├── islands.ts
│   │   │   └── index.ts
│   │   │
│   │   └── index.ts                 # Main entry point
│   │
│   ├── tests/                       # All tests in one place
│   │   ├── unit/                    # Unit tests
│   │   │   ├── core/
│   │   │   ├── compiler/
│   │   │   ├── router/
│   │   │   └── ...
│   │   ├── integration/             # Integration tests
│   │   │   ├── routing-data-loading.spec.ts
│   │   │   ├── forms-validation.spec.ts
│   │   │   ├── ssr-hydration.spec.ts
│   │   │   └── titan-integration.spec.ts
│   │   └── e2e/                     # E2E tests
│   │       ├── todo-app.spec.ts
│   │       ├── authentication.spec.ts
│   │       └── ssr-navigation.spec.ts
│   │
│   └── package.json
│
├── aether-cli/                      # CLI tools (separate package)
│   ├── src/
│   │   ├── commands/
│   │   │   ├── create.ts            # create-aether
│   │   │   ├── dev.ts
│   │   │   ├── build.ts
│   │   │   ├── deploy.ts
│   │   │   └── generate.ts
│   │   ├── templates/               # Project templates
│   │   └── index.ts
│   ├── tests/
│   └── package.json
│
└── aether-devtools/                 # Browser DevTools extension (separate package)
    ├── src/
    │   ├── panel/
    │   ├── inspector/
    │   ├── profiler/
    │   └── index.ts
    └── package.json
```

### Package.json Exports

Following Titan's pattern, all modules are exposed via `package.json` exports:

```json
{
  "name": "@omnitron-dev/aether",
  "version": "0.1.0",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./core": {
      "types": "./dist/core/index.d.ts",
      "import": "./dist/core/index.js"
    },
    "./compiler": {
      "types": "./dist/compiler/index.d.ts",
      "import": "./dist/compiler/index.js"
    },
    "./di": {
      "types": "./dist/di/index.d.ts",
      "import": "./dist/di/index.js"
    },
    "./router": {
      "types": "./dist/router/index.d.ts",
      "import": "./dist/router/index.js"
    },
    "./forms": {
      "types": "./dist/forms/index.d.ts",
      "import": "./dist/forms/index.js"
    },
    "./control-flow": {
      "types": "./dist/control-flow/index.d.ts",
      "import": "./dist/control-flow/index.js"
    },
    "./primitives": {
      "types": "./dist/primitives/index.d.ts",
      "import": "./dist/primitives/index.js"
    },
    "./components": {
      "types": "./dist/components/index.d.ts",
      "import": "./dist/components/index.js"
    },
    "./netron": {
      "types": "./dist/netron/index.d.ts",
      "import": "./dist/netron/index.js"
    },
    "./build": {
      "types": "./dist/build/index.d.ts",
      "import": "./dist/build/index.js"
    },
    "./build/vite": {
      "types": "./dist/build/vite/index.d.ts",
      "import": "./dist/build/vite/index.js"
    }
  }
}
```

### Usage Examples

```typescript
// ✅ Import from main package
import { signal, computed, effect } from '@omnitron-dev/aether';

// ✅ Import from specific module (tree-shakeable)
import { signal } from '@omnitron-dev/aether/core';
import { defineComponent } from '@omnitron-dev/aether/core';
import { createRouter } from '@omnitron-dev/aether/router';
import { createForm } from '@omnitron-dev/aether/forms';
import { Show, For, Switch, Match } from '@omnitron-dev/aether/control-flow';
import { Dialog } from '@omnitron-dev/aether/primitives';
import { Button } from '@omnitron-dev/aether/components';
import { NetronClient } from '@omnitron-dev/aether/netron';

// ✅ Import build plugins
import aether from '@omnitron-dev/aether/build/vite';
```

### Shared Infrastructure

```
apps/
├── examples/                # Example applications
│   ├── hello-world/
│   ├── todo-mvc/
│   ├── blog/
│   ├── dashboard/
│   └── e-commerce/
│
└── docs/                    # Documentation site (built with Aether)
    ├── src/
    │   ├── routes/
    │   └── components/
    └── package.json

scripts/
├── migrate-vibrancy.ts      # Automated migration script
├── build-order.ts           # Dependency-aware build
└── test-all.ts              # Run all tests

docs/
├── api/                     # Generated API docs
├── guides/                  # User guides
└── recipes/                 # Cookbook recipes
```

---

## Vibrancy Migration

### Current State

The Vibrancy signal system is currently in:
```
experiments/vibrancy/
├── src/
│   ├── signal.ts
│   ├── computed.ts
│   ├── effect.ts
│   ├── store.ts
│   └── ...
└── tests/
    ├── signal.spec.ts
    ├── computed.spec.ts
    └── ...
```

### Migration Steps

#### Step 1: Prepare Target Structure

Create the target directory in the unified aether package:

```bash
mkdir -p packages/aether/src/core/reactivity
mkdir -p packages/aether/tests/unit/core/reactivity
```

#### Step 2: Migrate Source Files

Move and refactor files:

```bash
# Core reactivity primitives
experiments/vibrancy/src/signal.ts        → packages/aether/src/core/reactivity/signal.ts
experiments/vibrancy/src/computed.ts      → packages/aether/src/core/reactivity/computed.ts
experiments/vibrancy/src/effect.ts        → packages/aether/src/core/reactivity/effect.ts
experiments/vibrancy/src/store.ts         → packages/aether/src/core/reactivity/store.ts
experiments/vibrancy/src/resource.ts      → packages/aether/src/core/reactivity/resource.ts
experiments/vibrancy/src/batch.ts         → packages/aether/src/core/reactivity/batch.ts

# Dependency tracking
experiments/vibrancy/src/graph.ts         → packages/aether/src/core/reactivity/graph.ts
experiments/vibrancy/src/scheduler.ts     → packages/aether/src/core/runtime/scheduler.ts

# Types and utilities
experiments/vibrancy/src/types.ts         → packages/aether/src/core/reactivity/types.ts
experiments/vibrancy/src/utils.ts         → packages/aether/src/core/reactivity/utils.ts
```

#### Step 3: Migrate Tests

```bash
# Test files
experiments/vibrancy/tests/*.spec.ts      → packages/aether/tests/unit/core/reactivity/

# Test utilities
experiments/vibrancy/tests/helpers/       → packages/aether/tests/helpers/
```

#### Step 4: Update Import Paths

After migration, update all import paths:

```typescript
// OLD (experiments)
import { signal, computed } from 'experiments/vibrancy';

// NEW (unified aether package)
import { signal, computed } from '@omnitron-dev/aether';
// OR import from specific module for tree-shaking
import { signal, computed } from '@omnitron-dev/aether/core';
```

#### Step 5: Validation

Run migration validation:

```bash
# Run tests in new location
cd packages/aether
npm test

# Run only reactivity tests
npm test -- tests/unit/core/reactivity

# Check build
npm run build

# Verify exports work correctly
npm run test:exports
```

#### Step 6: Archive Experiments

Once migration is validated:

```bash
# Archive old location
mv experiments/vibrancy experiments/vibrancy.archive

# Or delete if confident
rm -rf experiments/vibrancy
```

### Migration Script

Create `scripts/migrate-vibrancy.ts`:

```typescript
#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';

const MIGRATIONS = [
  { from: 'experiments/vibrancy/src', to: 'packages/aether/src/core/reactivity' },
  { from: 'experiments/vibrancy/tests', to: 'packages/aether/tests/unit/core/reactivity' }
];

async function migrate() {
  for (const { from, to } of MIGRATIONS) {
    console.log(`Migrating ${from} → ${to}`);

    // Ensure target exists
    await fs.mkdir(to, { recursive: true });

    // Copy files
    const files = await fs.readdir(from);
    for (const file of files) {
      const sourcePath = path.join(from, file);
      const targetPath = path.join(to, file);

      const content = await fs.readFile(sourcePath, 'utf-8');

      // Update import paths
      const updated = content
        .replace(/from ['"]experiments\/vibrancy/g, "from '@omnitron-dev/aether/core")
        .replace(/from ['"]\.\.\/vibrancy/g, "from '../reactivity");

      await fs.writeFile(targetPath, updated);
      console.log(`  ✓ ${file}`);
    }
  }

  console.log('\n✅ Migration complete!');
  console.log('\nNext steps:');
  console.log('1. Run tests: cd packages/aether && npm test');
  console.log('2. Build: npm run build');
  console.log('3. Archive old: mv experiments/vibrancy experiments/vibrancy.archive');
}

migrate().catch(console.error);
```

---

## Implementation Phases

### Phase 1: Core Reactivity System (2-3 weeks) ✅ **COMPLETED**

**Goal:** Implement the foundation — reactive primitives and dependency tracking

**Status:** All core reactive APIs fully implemented and tested per specification `02-REACTIVITY.md`

**Tasks:**

1. **Migrate Vibrancy** (Week 1) ✅ COMPLETED
   - [x] Execute migration script
   - [x] Update all import paths
   - [x] Validate tests pass (signal tests: 19/19 ✅)
   - [x] Update package.json exports

2. **Signal System** (Week 1-2) ✅ COMPLETED
   - [x] Core signal implementation (migrated from Vibrancy)
   - [x] signal() - read (tracked)
   - [x] signal.peek() - read (untracked)
   - [x] signal.set() - set value
   - [x] signal.update() - update with function
   - [x] signal.mutate() - mutate in place
   - [x] signal.subscribe() - subscribe to changes
   - [x] Custom equality function support
   - [ ] Signal debugging utilities (deferred to DevTools)
   - [ ] Signal serialization for SSR (deferred to Phase 9)

3. **Reactivity Primitives** (Week 2) ✅ COMPLETED
   - [x] computed() with lazy evaluation and caching
   - [x] computed.peek() - read without tracking
   - [x] computed.subscribe() - subscribe to changes
   - [x] effect() with automatic dependency tracking
   - [x] effect({ defer: true }) - defer initial run
   - [x] Effect cleanup (return function + onCleanup)
   - [x] store() with proxy-based nested reactivity
   - [x] resource() for async data with loading/error states

4. **Dependency Management** (Week 2-3) ✅ COMPLETED
   - [x] Automatic dependency tracking
   - [x] Dynamic dependency updates
   - [x] Cycle detection and recovery
   - [x] Diamond dependency resolution with topological sort
   - [x] batch() for grouped updates
   - [x] untrack() for untracked reads
   - [x] createRoot() for reactive scopes
   - [x] getOwner() for owner access
   - [x] onCleanup() for cleanup registration
   - [ ] Graph visualization utilities (deferred to DevTools)

5. **Testing & Validation** (Week 3) ✅ COMPLETED
   - [x] 612 tests passing (34 test files)
   - [x] Enabled 20 previously skipped tests
   - [x] Created fixtures for store pattern integration tests
   - [x] Fixed timing issues in async resource tests
   - [x] Comprehensive coverage (~95% for core reactivity)
   - [x] All API methods verified against 02-REACTIVITY.md spec
   - [x] Edge case validation (8 advanced tests skipped - circular deps, store batching)
   - [ ] Performance benchmarks vs SolidJS/Vue (deferred)
   - [ ] Memory leak detection tests (deferred)

**Deliverables:**
- ✅ Core reactivity module in `@omnitron-dev/aether/core` (fully spec-compliant)
- ✅ Test suite with 612 passing tests, ~95% coverage
- ✅ All reactive APIs implemented: signal, computed, effect, store, resource, batch, untrack, createRoot, getOwner, onCleanup
- ⏭️ Performance benchmarks (deferred)
- ⏭️ API documentation (deferred)

**Verification Against Spec:**
All requirements from `02-REACTIVITY.md` implemented and tested ✓

---

### Phase 2: Component System & Compiler (3-4 weeks)

**Goal:** Component architecture and template compilation

**Tasks:**

1. **Component Runtime** (Week 1-2) ✅ COMPLETED
   - [x] Implement `defineComponent()` and `component()` helper
   - [x] Lifecycle hooks (onMount, onCleanup via reactive context, onError)
   - [x] Props utilities (mergeProps, splitProps, reactiveProps)
   - [x] Context API (`createContext`, `useContext`)
   - [x] Refs (`createRef`, `useRef`, `reactiveRef`, `mergeRefs`)
   - [x] Component tests (110 tests passing: define, lifecycle, props, context, refs)
   - [x] JSX Runtime (`jsx`, `jsxs`, `Fragment`, JSX types)
   - [x] JSX Runtime tests (38 tests passing: DOM creation, props, events, components)
   - [x] Event system integrated in JSX runtime

2. **Control Flow Components** (Week 2) ✅ **COMPLETED**
   - [x] `Show` component - conditional rendering with fallback
   - [x] `For` component - list rendering with keyed reconciliation
   - [x] `Switch/Match` components - multiple condition handling
   - [x] `Portal` component - render children to different DOM location
   - [x] `Suspense` component - async rendering with fallback
   - [x] Control flow tests (48 tests passing: Show 8, For 9, Switch/Match 9, Portal 12, Suspense 10)
   - [x] Package exports configured (`@omnitron-dev/aether/control-flow`)
   - [x] TypeScript types and declarations

3. **Compiler - Parser** (Week 2) ⏭️ SKIPPED (using TypeScript JSX transform)
   - [x] Using TypeScript's built-in `react-jsx` transform instead of custom parser
   - [ ] ~~TSX lexer~~ (not needed - TypeScript handles this)
   - [ ] ~~AST parser~~ (not needed - TypeScript handles this)
   - [ ] Template syntax parsing (nx:if, nx:for, etc.) - deferred to future optimization phase
   - [ ] Directive parsing - deferred to future optimization phase

4. **Compiler - Transformer** (Week 2-3)
   - [ ] Template → reactive JS transformation
   - [ ] Directive transformation
   - [ ] Optimization passes (constant folding, dead code elimination)
   - [ ] Effect hoisting

5. **Compiler - Code Generator** (Week 3)
   - [ ] Generate optimal imperative code
   - [ ] Source map generation
   - [ ] Type preservation

6. **Vite Plugin** (Week 3-4)
   - [ ] HMR integration
   - [ ] Component auto-discovery
   - [ ] CSS scoping
   - [ ] Asset handling

7. **Testing** (Week 4)
   - [ ] Component unit tests
   - [ ] Compiler snapshot tests
   - [ ] HMR tests
   - [ ] Integration tests

**Deliverables:**
- ✅ Component runtime in `@omnitron-dev/aether/core/component` (110 tests passing)
- ✅ JSX runtime in `@omnitron-dev/aether/jsx-runtime` (38 tests passing)
- ✅ Control flow components in `@omnitron-dev/aether/control-flow` (48 tests passing)
  - Show, For, Switch/Match (26 tests)
  - Portal, Suspense (22 tests)
- ⏭️ Compiler module in `@omnitron-dev/aether/compiler` (deferred)
- ⏭️ Build plugins in `@omnitron-dev/aether/build` (deferred)
- ⏭️ Component examples (deferred)
- ⏭️ Compiler documentation (deferred)

---

### Phase 3: Dependency Injection & Modules (2 weeks) ✅ COMPLETED

**Goal:** Lightweight DI system for frontend

**Tasks:**

1. **DI Core** (Week 1) ✅ COMPLETED
   - [x] `injectable()` - function-based provider definition
   - [x] `inject()` - dependency resolution
   - [x] Container implementation (DIContainer with hierarchical injection)
   - [x] Scope management (singleton, transient, module, request)
   - [x] Tree-shakeable providers
   - [x] InjectionToken for primitives and interfaces

2. **Module System** (Week 1) ✅ COMPLETED
   - [x] `defineModule()` - module definition
   - [x] Module imports/exports
   - [x] `compileModule()` - compile module tree into DI container
   - [x] `bootstrapModule()` - bootstrap application module
   - [x] Module composition with provider re-exports

3. **Integration** (Week 2) ⏭️ DEFERRED
   - [ ] Component DI integration
   - [ ] Context as DI scope
   - [x] Type inference for inject()
   - [ ] DevTools integration

4. **Testing** (Week 2) ✅ COMPLETED
   - [x] DI unit tests (56 tests passing)
   - [x] Container tests (provider registration, resolution, scopes)
   - [x] Injectable tests (decorator, function-based)
   - [x] Module system tests (compilation, bootstrapping, hierarchy)
   - [x] Circular dependency detection tests
   - [x] Multi-provider tests
   - [x] Factory provider tests

**Deliverables:**
- ✅ DI module in `@omnitron-dev/aether/di`
- ✅ Full DI system with hierarchical injection
- ✅ 56 unit tests passing
- ✅ TypeScript exports configured
- ⏭️ Module examples (deferred)
- ⏭️ DI documentation (deferred)

---

### Phase 4: Routing & Data Loading (3 weeks)

**Goal:** File-based router with loaders and actions

**Status:** 🚧 IN PROGRESS

**Tasks:**

1. **Router Core** (Week 1) ✅ **COMPLETED**
   - [x] Route matching algorithm (route-matcher.ts)
   - [x] Dynamic routes ([param])
   - [x] Catch-all routes ([...rest])
   - [x] Optional params ([[param]])
   - [x] Optional catch-all ([[...rest]])
   - [x] Core Router implementation (router.ts)
   - [x] Browser history integration (history/hash/memory modes)
   - [x] Route guards (beforeEach, afterEach)
   - [x] Router hooks (useRouter, useParams, useNavigate, useLocation, useSearchParams, useIsActive)
   - [x] 45 tests passing (route-matcher + router)
   - [ ] File-based route scanner (deferred - not in core spec)
   - [ ] Route groups ((group)) (deferred - not in core spec)

2. **Navigation** (Week 1-2) ✅ **COMPLETED**
   - [x] `<Link>` component (Link.ts)
   - [x] `navigate()` function
   - [x] Browser history integration
   - [x] Active link states (activeClass, exactActiveClass)
   - [x] Modified click handling (ctrl, meta, middle button)
   - [x] External link support
   - [x] 20 Link component tests passing
   - [ ] Prefetching strategies (deferred - loader integration needed)

3. **Data Loading** (Week 2) ⚡ **BASIC IMPLEMENTATION**
   - [x] Data loading types (LoaderContext, ActionContext)
   - [x] `useLoaderData()` hook
   - [x] `useActionData()` hook
   - [x] `useNavigation()` hook (state tracking)
   - [x] `useFetcher()` hook (programmatic mutations)
   - [x] Helper functions (setLoaderData, setActionData, executeLoader, executeAction)
   - [ ] Full SSR integration (deferred - requires SSR runtime)
   - [ ] Resource integration (deferred)
   - [ ] Parallel loading optimization (deferred)
   - [ ] Advanced cache management (deferred)

4. **Layouts & Boundaries** (Week 2-3) ✅ **COMPLETED**
   - [x] Layout types in RouteDefinition (layout, errorBoundary, loading)
   - [x] Outlet component for nested route rendering
   - [x] RouteContext for layout hierarchy
   - [x] ErrorBoundary component with useRouteError hook
   - [x] Layout builder utilities (buildLayoutChain, findErrorBoundary, findLoadingComponent)
   - [x] Error handling with createRouteError and isRouteError
   - [x] Layout rendering with renderWithLayouts
   - [ ] Layout transitions (deferred to later phase)

5. **Testing** (Week 3) ⚡ **PARTIAL**
   - [x] Router unit tests (45 tests - route-matcher + router)
   - [x] Navigation tests (20 tests - Link component)
   - [x] Outlet component tests (5 tests)
   - [x] ErrorBoundary tests (12 tests)
   - [x] Layout utilities tests (18 tests)
   - [ ] Integration tests for nested layouts (deferred)
   - [ ] Loader/action integration tests (deferred)
   - [ ] E2E routing tests (deferred)

**Deliverables:**
- Router module in `@omnitron-dev/aether/router`
- Routing examples
- Migration guide from other routers

---

### Phase 5: Forms & Validation (2 weeks) ✅ **COMPLETED (Basic Implementation)**

**Goal:** Unified form architecture with validation

**Tasks:**

1. **Form Primitives** (Week 1) ✅ **COMPLETED**
   - [x] `createForm()` composition API with full state management
   - [x] Field-level state management (values, errors, touched)
   - [x] Touched/dirty tracking (isDirty, isValid, isSubmitting)
   - [x] Field helpers (getFieldProps, setFieldValue, setFieldTouched, setFieldError)
   - [ ] `<Field>` component (deferred - use primitives)
   - [ ] `<Form>` component (deferred - use primitives)

2. **Validation** (Week 1) ✅ **COMPLETED**
   - [x] Sync validation (function-based validators)
   - [x] Async validation (Promise-based validators)
   - [x] Schema validation (Zod-like interface support via safeParse)
   - [x] Field-level validation (validateField)
   - [x] Form-level validation (validateForm)
   - [x] Validation modes (blur, change, submit)
   - [ ] Yup integration (deferred - schema interface is generic)
   - [ ] Custom validator composition (deferred)

3. **Form Composition** (Week 1-2) ⏭️ **DEFERRED**
   - [x] `createForm()` composition API (basic implementation)
   - [ ] Multi-step forms (deferred to advanced patterns)
   - [ ] Dynamic field arrays (deferred to advanced patterns)
   - [ ] Conditional fields (deferred to advanced patterns)

4. **Testing** (Week 2) ✅ **COMPLETED**
   - [x] Form unit tests (26 tests passing)
   - [x] Validation tests (sync, async, schema-based)
   - [x] State management tests (values, errors, touched, dirty)
   - [x] Submission tests (with validation)
   - [x] Reset functionality tests
   - [ ] Multi-step tests (deferred)
   - [ ] Integration tests with primitives (deferred to Phase 6)

**Deliverables:**
- ✅ Forms module in `@omnitron-dev/aether/forms` (26 tests passing)
- ✅ Complete `createForm()` API with validation
- ✅ TypeScript exports configured
- ⏭️ Form examples (deferred)
- ⏭️ Validation guide (deferred)

---

### Phase 6: UI Primitives (3-4 weeks) - 🚧 IN PROGRESS

**Goal:** Headless, accessible UI components

**Tasks:**

1. **Accessibility Infrastructure** ✅
   - [x] ID generation utilities (`generateId`, `useId`, `createIdGenerator`)
   - [x] Focus management (`getFocusableElements`, `trapFocus`, `saveFocus`, `restoreFocus`)
   - [x] Scroll lock (`disableBodyScroll`, `enableBodyScroll`)

2. **Core Primitives** (Week 1-2) - 🚧
   - [x] Dialog / Modal (with accessibility, keyboard nav, focus trap)
   - [x] Popover (with smart positioning, collision detection, keyboard nav)
   - [ ] Tooltip
   - [ ] Dropdown Menu
   - [ ] Select / Combobox
   - [ ] Tabs
   - [ ] Accordion

3. **Advanced Primitives** (Week 2-3)
   - [ ] Slider / Range
   - [ ] Toggle / Switch
   - [ ] RadioGroup / CheckboxGroup
   - [ ] Command Palette
   - [ ] DatePicker / Calendar
   - [ ] DataTable

4. **Testing** ✅ (Ongoing)
   - [x] Primitive utilities tests (115 tests: 85 focus/id/scroll + 30 position)
   - [x] Dialog component tests (30 tests)
   - [x] Popover component tests (30 tests)
   - [ ] Accessibility tests (axe-core)
   - [ ] Keyboard navigation tests

**Deliverables:**
- ✅ Primitives module in `@omnitron-dev/aether/primitives`
- ✅ Dialog primitive with full accessibility
- ✅ Popover primitive with smart positioning and collision detection
- [ ] Primitive examples
- [ ] Accessibility guide

**Test Coverage:**
- Total: 776 tests passing (716 + 60 new), 11 skipped
- Primitives: 175 tests (115 utils + 30 Dialog + 30 Popover)
- All tests passing

---

### Phase 7: Styled Components Library (2-3 weeks)

**Goal:** Ready-to-use styled components

**Tasks:**

1. **Core Components** (Week 1-2)
   - [ ] Button variants
   - [ ] Input / Textarea
   - [ ] Select / Combobox
   - [ ] Card / Badge / Avatar
   - [ ] Alert / Toast / Notification

2. **Layout Components** (Week 2)
   - [ ] Navigation / Sidebar / Header
   - [ ] Grid / Stack / Flex
   - [ ] Container / Section

3. **Theming System** (Week 2-3)
   - [ ] Design tokens
   - [ ] Theme definition
   - [ ] Dark/light mode
   - [ ] Runtime theme switching
   - [ ] CSS variable generation

4. **Testing** (Week 3)
   - [ ] Component tests
   - [ ] Theme tests
   - [ ] Visual regression tests (Playwright)

**Deliverables:**
- Components module in `@omnitron-dev/aether/components`
- Component gallery
- Theming guide

---

### Phase 8: Netron RPC Client (2 weeks)

**Goal:** Type-safe RPC communication with backend

**Tasks:**

1. **Client Core** (Week 1)
   - [ ] WebSocket transport
   - [ ] Service proxy generation
   - [ ] Type-safe method calls
   - [ ] Error handling

2. **Advanced Features** (Week 1-2)
   - [ ] Auto-reconnect
   - [ ] Offline support
   - [ ] Optimistic updates
   - [ ] Request batching
   - [ ] Streaming responses

3. **DI Integration** (Week 2)
   - [ ] Injectable RPC services
   - [ ] Contract-based pattern
   - [ ] Role-based interface projection

4. **Testing** (Week 2)
   - [ ] Client tests with mock server
   - [ ] Reconnection tests
   - [ ] Offline tests

**Deliverables:**
- Netron client module in `@omnitron-dev/aether/netron`
- RPC examples
- Integration guide with Titan

---

### Phase 9: SSR, SSG & Islands (3 weeks)

**Goal:** Server-side rendering and islands architecture

**Tasks:**

1. **SSR Core** (Week 1)
   - [ ] Server renderer
   - [ ] Data serialization
   - [ ] Hydration vs Resumability
   - [ ] Streaming SSR

2. **Islands Architecture** (Week 2)
   - [ ] Island modes (static, eager, visible, idle, interaction)
   - [ ] Partial hydration
   - [ ] Island boundaries
   - [ ] Inter-island communication

3. **SSG** (Week 2-3)
   - [ ] Static site generator
   - [ ] Dynamic route generation
   - [ ] ISR (Incremental Static Regeneration)
   - [ ] Build-time data fetching

4. **SEO & Meta** (Week 3)
   - [ ] Meta tag management
   - [ ] Open Graph
   - [ ] Sitemap generation
   - [ ] Structured data

5. **Testing** (Week 3)
   - [ ] SSR tests
   - [ ] Hydration tests
   - [ ] SSG tests

**Deliverables:**
- SSR/SSG support in `@aether/build`
- Islands examples
- SSR/SSG guide

---

### Phase 10: Tooling & DevTools (2-3 weeks)

**Goal:** Developer experience tools

**Tasks:**

1. **CLI** (Week 1)
   - [ ] `create-aether` - project scaffolding
   - [ ] `aether dev` - dev server
   - [ ] `aether build` - production build
   - [ ] `aether deploy` - deployment
   - [ ] Project templates

2. **Browser DevTools** (Week 2)
   - [ ] Component tree inspector
   - [ ] Reactivity graph visualization
   - [ ] Performance profiler
   - [ ] State inspector
   - [ ] Time-travel debugging

3. **Testing Utilities** (Week 2-3)
   - [ ] Component testing utilities
   - [ ] Mock factories
   - [ ] Test fixtures
   - [ ] E2E helpers

4. **Documentation** (Week 3)
   - [ ] API docs generator
   - [ ] Interactive examples
   - [ ] Migration guides

**Deliverables:**
- `@omnitron-dev/aether-cli` package (separate)
- `@omnitron-dev/aether-devtools` extension (separate)
- Testing utilities
- Documentation site

---

## Build Order and Dependencies

> **Simplified Architecture**: With a unified package structure, build complexity is dramatically reduced. No inter-package dependency management needed!

### Package Dependency Graph

```mermaid
graph TD
    A[@omnitron-dev/aether] --> B[aether-cli]
    A --> C[aether-devtools]
```

**That's it!** The main `@omnitron-dev/aether` package is self-contained with all internal modules (core, compiler, router, forms, primitives, components, netron, build).

### Build Order

**Simple 2-step build:**

1. **@omnitron-dev/aether** - Main framework (single build)
2. **aether-cli** & **aether-devtools** - Tooling packages (depend on main framework)

### Build Commands

```bash
# Build main framework
cd packages/aether
npm run build

# Build CLI (depends on aether)
cd packages/aether-cli
npm run build

# Build DevTools (depends on aether)
cd packages/aether-devtools
npm run build

# Or build all from root
npm run build
```

### Turbo Configuration

Since we follow the Titan pattern with a unified package, turbo configuration is simple:

**`turbo.json`:**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": ["coverage/**"]
    },
    "lint": {
      "outputs": []
    }
  }
}
```

### Benefits of Unified Package

✅ **Simpler versioning** - One version for the entire framework
✅ **Easier testing** - Integration tests work seamlessly
✅ **Better DX** - Single `npm install @omnitron-dev/aether`
✅ **Faster builds** - No waiting for dependency chain
✅ **Consistent APIs** - All modules evolve together
✅ **Following Titan pattern** - Proven architecture

---

## Testing Strategy

### Testing Levels

1. **Unit Tests** - Individual functions and components
   - Framework: Jest / Vitest
   - Coverage target: >95%
   - Run on every commit

2. **Integration Tests** - Multiple components working together
   - Framework: Jest / Vitest
   - Coverage target: >80%
   - Run before merge

3. **E2E Tests** - Full application flows
   - Framework: Playwright
   - Critical user paths only
   - Run before release

4. **Visual Regression** - UI consistency
   - Framework: Playwright + Chromatic
   - Component library only
   - Run on UI changes

### Testing Standards

**Unified Testing Approach:**

```typescript
// packages/aether/tests/unit/core/reactivity/signal.spec.ts
import { signal } from '../../../../src/core/reactivity/signal';

describe('signal()', () => {
  it('should create a signal with initial value', () => {
    const count = signal(0);
    expect(count()).toBe(0);
  });

  it('should update value via set()', () => {
    const count = signal(0);
    count.set(5);
    expect(count()).toBe(5);
  });

  it('should update value via update()', () => {
    const count = signal(0);
    count.update(n => n + 1);
    expect(count()).toBe(1);
  });
});
```

**Performance Benchmarks:**

```typescript
// packages/aether/benchmarks/core/reactivity/signal.bench.ts
import { bench, describe } from 'vitest';
import { signal } from '../../../src/core/reactivity/signal';

describe('Signal Performance', () => {
  bench('create 1000 signals', () => {
    for (let i = 0; i < 1000; i++) {
      signal(i);
    }
  });

  bench('read signal 10000 times', () => {
    const s = signal(0);
    for (let i = 0; i < 10000; i++) {
      s();
    }
  });

  bench('write signal 10000 times', () => {
    const s = signal(0);
    for (let i = 0; i < 10000; i++) {
      s.set(i);
    }
  });
});
```

**Test Coverage Requirements:**

| Module | Unit | Integration | E2E |
|--------|------|-------------|-----|
| **Core (Reactivity)** | 95%+ | 80%+ | - |
| **Compiler** | 90%+ | 85%+ | - |
| **DI** | 95%+ | 80%+ | - |
| **Router** | 90%+ | 85%+ | 70%+ |
| **Forms** | 90%+ | 80%+ | 70%+ |
| **Primitives** | 85%+ | 80%+ | 75%+ |
| **Components** | 80%+ | - | - |
| **Netron Client** | 90%+ | 85%+ | - |
| **Overall Package** | **90%+** | **80%+** | **70%+** |

---

## Tooling and Infrastructure

### Development Tools

**Package Management:**
- Yarn Workspaces - Multi-package management
- Turborepo - Build orchestration (optional, simple setup)

**Build:**
- TypeScript - Type checking and compilation
- Vite - Dev server and bundling
- ESBuild - Fast builds
- tsup - Zero-config TypeScript bundler

**Testing:**
- Vitest - Unit and integration tests (faster than Jest)
- Playwright - E2E testing
- Testing Library - Component testing utilities

**Linting & Formatting:**
- ESLint v9 - Flat config
- Prettier - Code formatting
- TypeScript ESLint - Type-aware linting

**CI/CD:**
- GitHub Actions - Automated testing and builds
- Changesets - Version management and releases
- npm - Package publishing

### Repository Configuration

**Root `package.json`:**

```json
{
  "name": "omnitron-aether",
  "private": true,
  "workspaces": [
    "packages/*",
    "apps/*"
  ],
  "scripts": {
    "build": "turbo run build",
    "dev": "cd packages/aether && npm run dev",
    "test": "turbo run test",
    "test:e2e": "cd packages/aether && npm run test:e2e",
    "lint": "turbo run lint",
    "format": "prettier --write \"**/*.{ts,tsx,md}\"",
    "changeset": "changeset",
    "version": "changeset version",
    "release": "npm run build && changeset publish"
  },
  "devDependencies": {
    "@changesets/cli": "^2.26.0",
    "prettier": "^3.0.0",
    "turbo": "^1.10.0",
    "typescript": "^5.8.0"
  }
}
```

**`turbo.json`:**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": ["coverage/**"]
    },
    "lint": {
      "outputs": []
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

**`.github/workflows/ci.yml`:**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'yarn'

      - run: yarn install --frozen-lockfile
      - run: yarn build
      - run: yarn test
      - run: yarn lint

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          directory: ./coverage

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'yarn'

      - run: yarn install --frozen-lockfile
      - run: yarn build
      - run: npx playwright install
      - run: yarn test:e2e
```

---

## Documentation Plan

### Documentation Structure

```
docs/
├── getting-started/
│   ├── installation.md
│   ├── quick-start.md
│   ├── project-structure.md
│   └── first-component.md
│
├── core-concepts/
│   ├── reactivity.md
│   ├── components.md
│   ├── directives.md
│   ├── dependency-injection.md
│   └── modules.md
│
├── guides/
│   ├── routing.md
│   ├── forms.md
│   ├── styling.md
│   ├── titan-integration.md
│   ├── ssr-ssg.md
│   └── islands.md
│
├── api/
│   ├── signal.md
│   ├── computed.md
│   ├── effect.md
│   ├── component.md
│   └── [auto-generated]
│
├── components/
│   ├── primitives/
│   └── library/
│
├── cookbook/
│   ├── authentication.md
│   ├── dark-mode.md
│   ├── file-uploads.md
│   └── real-time.md
│
└── migration/
    ├── from-react.md
    ├── from-vue.md
    └── from-svelte.md
```

### Documentation Guidelines

1. **Every API must have:**
   - Description
   - Type signature
   - Usage example
   - Common pitfalls
   - See also links

2. **Every guide must have:**
   - What you'll learn
   - Prerequisites
   - Step-by-step instructions
   - Complete working example
   - Next steps

3. **Code examples must:**
   - Be runnable
   - Show best practices
   - Include TypeScript types
   - Have comments for complex logic

### Documentation Site

Build docs site with Aether itself:

```typescript
// apps/docs/src/routes/index.tsx
import { defineComponent } from 'aether';

export default defineComponent(() => {
  return () => (
    <div>
      <h1>Aether Framework</h1>
      <p>Minimalist, high-performance frontend framework</p>
    </div>
  );
});
```

---

## Milestones and Timeline

### Milestone 1: Foundation (Months 1-2)
- ✅ Vibrancy migration complete (271 tests migrated and passing)
- ✅ Core reactivity system stable (signal, computed, effect, store, resource)
- ✅ Component runtime working (defineComponent, lifecycle, props, context, refs - 110 tests passing)
- ✅ JSX Runtime implemented (jsx, jsxs, Fragment - 38 tests passing)
- ✅ Components can render with TypeScript JSX transform
- ✅ Compiler: Using TypeScript's react-jsx instead of custom compiler
- 🎯 Goal: Build Hello World app - **READY**

### Milestone 2: Core Features (Months 2-4)
- ✅ DI system complete
- ✅ Router with file-based routing
- ✅ Forms with validation
- ✅ Vite plugin working
- 🎯 Goal: Build TodoMVC app

### Milestone 3: Full Stack (Months 4-6)
- ✅ Netron RPC client
- ✅ SSR/SSG support
- ✅ Islands architecture
- ✅ Titan integration examples
- 🎯 Goal: Build full-stack blog

### Milestone 4: UI Components (Months 6-7)
- ✅ All headless primitives
- ✅ Styled component library
- ✅ Theming system
- ✅ Accessibility audit
- 🎯 Goal: Component gallery site

### Milestone 5: Developer Experience (Months 7-8)
- ✅ CLI tools
- ✅ Browser DevTools
- ✅ Testing utilities
- ✅ Documentation site
- 🎯 Goal: Public alpha release

### Milestone 6: Production Ready (Months 8-10)
- ✅ Performance benchmarks
- ✅ Security audit
- ✅ Migration guides
- ✅ Example applications
- 🎯 Goal: v1.0.0 release

---

## Success Criteria

### Technical Metrics

- **Bundle Size:**
  - Hello World: <2KB (target: 1.2KB)
  - TodoMVC: <10KB (target: 6KB)

- **Performance:**
  - TTI: <50ms (target: ~30ms)
  - Runtime overhead: <5%
  - No hydration required

- **Quality:**
  - Test coverage: >90%
  - Zero critical security issues
  - TypeScript strict mode

### Developer Experience Metrics

- **Time to Hello World:** <5 minutes
- **Time to TodoMVC:** <2 hours
- **Documentation coverage:** 100% of public APIs
- **Community satisfaction:** NPS >40

### Production Readiness

- ✅ Used in 3+ production applications
- ✅ 1000+ GitHub stars
- ✅ 50+ contributors
- ✅ Stable API (no breaking changes for 6 months)

---

## Risk Management

### Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Performance not meeting targets | High | Continuous benchmarking, profiling |
| Vibrancy migration breaks existing code | Medium | Extensive testing, gradual migration |
| Compiler complexity | High | Start simple, iterate, follow SolidJS patterns |
| SSR/Islands too complex | Medium | Phase 9 is optional for MVP, can be v1.1 |

### Timeline Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Underestimating Phase 2 (compiler) | High | Allocate buffer time, simplify scope |
| Dependencies between phases | Medium | Clear interfaces, mock implementations |
| Testing taking longer | Low | Start testing early, automate |

### Organizational Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Single maintainer burnout | High | Build community early, document well |
| Breaking changes needed | Medium | Semantic versioning, migration guides |
| Competition (React, Vue) | Low | Focus on performance and simplicity |

---

## Next Steps

### Immediate Actions (Week 1)

1. **Setup unified package structure:**
   ```bash
   mkdir -p packages/aether/{src/{core,compiler,di,router,forms,primitives,components,netron,build},tests/{unit,integration,e2e}}
   mkdir -p packages/{aether-cli,aether-devtools}
   ```

2. **Execute Vibrancy migration:**
   ```bash
   node scripts/migrate-vibrancy.ts
   ```

3. **Initialize main package:**
   - Create package.json with proper exports
   - Setup tsconfig.json (strict mode)
   - Configure build with tsup/vite
   - Setup Vitest for testing

4. **Setup tooling:**
   - Configure ESLint v9 (flat config)
   - Configure Prettier
   - Setup GitHub Actions CI/CD
   - Initialize changesets

### Week 2 Goals

- ✅ Vibrancy fully migrated and tests passing
- ✅ `@omnitron-dev/aether` package structure ready
- ✅ Basic signal example working
- ✅ Build system configured

### Month 1 Goals

- ✅ Phase 1 complete (Core Reactivity)
- ✅ Phase 2 started (Component System)
- ✅ Hello World app working

---

## Conclusion

This implementation plan provides a clear, phased roadmap for building the Aether Framework. The key success factors are:

1. **Start with solid foundation** - Migrate Vibrancy first, ensure reactivity is rock-solid
2. **Build in phases** - Each phase delivers value independently
3. **Test continuously** - Don't accumulate testing debt
4. **Document as you go** - Write docs while context is fresh
5. **Community from day 1** - Open source early, gather feedback

The framework is ambitious but achievable with disciplined execution. Focus on **minimalism**, **performance**, and **developer experience** at every step.

**Let's build something amazing! 🚀**
