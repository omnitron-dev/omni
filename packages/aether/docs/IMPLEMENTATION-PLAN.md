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

### Phase 1: Core Reactivity System (2-3 weeks)

**Goal:** Implement the foundation — reactive primitives and dependency tracking

**Tasks:**

1. **Migrate Vibrancy** (Week 1) ✅ COMPLETED
   - [x] Execute migration script
   - [x] Update all import paths
   - [x] Validate tests pass (signal tests: 19/19 ✅)
   - [x] Update package.json exports

2. **Enhance Signal System** (Week 1-2) 🔄 IN PROGRESS
   - [x] Core signal implementation (migrated from Vibrancy)
   - [ ] Optimize signal performance
   - [ ] Add signal debugging utilities
   - [ ] Implement signal serialization (SSR)
   - [ ] Add TypeScript inference improvements

3. **Complete Reactivity Primitives** (Week 2) ✅ MIGRATED (needs validation)
   - [x] Finalize `computed()` memoization (migrated from Vibrancy)
   - [x] Complete `effect()` with cleanup (migrated from Vibrancy)
   - [x] Implement `store()` with proxy-based reactivity (migrated from Vibrancy)
   - [x] Add `resource()` for async data (migrated from Vibrancy)

4. **Dependency Graph** (Week 2-3) ✅ MIGRATED (needs validation)
   - [x] Implement efficient dependency tracking (migrated from Vibrancy)
   - [x] Add cycle detection (migrated from Vibrancy)
   - [x] Optimize update batching (migrated from Vibrancy)
   - [ ] Create graph visualization utilities (for DevTools)

5. **Testing & Benchmarks** (Week 3) 🔄 IN PROGRESS
   - [x] Unit tests migrated from Vibrancy
   - [ ] Run all unit tests and fix failures
   - [ ] Comprehensive unit tests (>95% coverage)
   - [ ] Performance benchmarks vs SolidJS/Vue
   - [ ] Memory leak detection tests
   - [ ] Edge case validation

**Deliverables:**
- Core reactivity module in `@omnitron-dev/aether/core`
- Test suite with >95% coverage
- Performance benchmarks
- API documentation

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
   - [ ] Event system (deferred to JSX runtime integration)

2. **Compiler - Parser** (Week 2)
   - [ ] TSX lexer
   - [ ] AST parser
   - [ ] Template syntax parsing (nx:if, nx:for, etc.)
   - [ ] Directive parsing

3. **Compiler - Transformer** (Week 2-3)
   - [ ] Template → reactive JS transformation
   - [ ] Directive transformation
   - [ ] Optimization passes (constant folding, dead code elimination)
   - [ ] Effect hoisting

4. **Compiler - Code Generator** (Week 3)
   - [ ] Generate optimal imperative code
   - [ ] Source map generation
   - [ ] Type preservation

5. **Vite Plugin** (Week 3-4)
   - [ ] HMR integration
   - [ ] Component auto-discovery
   - [ ] CSS scoping
   - [ ] Asset handling

6. **Testing** (Week 4)
   - [ ] Component unit tests
   - [ ] Compiler snapshot tests
   - [ ] HMR tests
   - [ ] Integration tests

**Deliverables:**
- Compiler module in `@omnitron-dev/aether/compiler`
- Build plugins in `@omnitron-dev/aether/build`
- Component examples
- Compiler documentation

---

### Phase 3: Dependency Injection & Modules (2 weeks)

**Goal:** Lightweight DI system for frontend

**Tasks:**

1. **DI Core** (Week 1)
   - [ ] `injectable()` - function-based provider definition
   - [ ] `inject()` - dependency resolution
   - [ ] Container implementation
   - [ ] Scope management (singleton, transient)
   - [ ] Tree-shakeable providers

2. **Module System** (Week 1)
   - [ ] `defineModule()` - module definition
   - [ ] Module imports/exports
   - [ ] Lazy module loading
   - [ ] Module composition

3. **Integration** (Week 2)
   - [ ] Component DI integration
   - [ ] Context as DI scope
   - [ ] Type inference for inject()
   - [ ] DevTools integration

4. **Testing** (Week 2)
   - [ ] DI unit tests
   - [ ] Module composition tests
   - [ ] Circular dependency detection tests

**Deliverables:**
- DI module in `@omnitron-dev/aether/di`
- Module examples
- DI documentation

---

### Phase 4: Routing & Data Loading (3 weeks)

**Goal:** File-based router with loaders and actions

**Tasks:**

1. **Router Core** (Week 1)
   - [ ] Route matching algorithm
   - [ ] File-based route scanner
   - [ ] Dynamic routes ([param])
   - [ ] Catch-all routes ([...rest])
   - [ ] Route groups ((group))

2. **Navigation** (Week 1-2)
   - [ ] `<Link>` component
   - [ ] `navigate()` function
   - [ ] Browser history integration
   - [ ] Prefetching strategies
   - [ ] Route guards

3. **Data Loading** (Week 2)
   - [ ] `loader()` - SSR data fetching
   - [ ] `action()` - form mutations
   - [ ] Resource integration
   - [ ] Parallel loading
   - [ ] Cache management

4. **Layouts & Boundaries** (Week 2-3)
   - [ ] `+layout.tsx` files
   - [ ] Nested layouts
   - [ ] `+error.tsx` - error boundaries
   - [ ] `+loading.tsx` - loading states
   - [ ] Layout transitions

5. **Testing** (Week 3)
   - [ ] Router unit tests
   - [ ] Navigation tests
   - [ ] Loader/action tests
   - [ ] E2E routing tests

**Deliverables:**
- Router module in `@omnitron-dev/aether/router`
- Routing examples
- Migration guide from other routers

---

### Phase 5: Forms & Validation (2 weeks)

**Goal:** Unified form architecture with validation

**Tasks:**

1. **Form Primitives** (Week 1)
   - [ ] `<Field>` component
   - [ ] `<Form>` component
   - [ ] Field-level state management
   - [ ] Touched/dirty tracking

2. **Validation** (Week 1)
   - [ ] Sync validation
   - [ ] Async validation
   - [ ] Zod integration
   - [ ] Yup integration
   - [ ] Custom validators

3. **Form Composition** (Week 1-2)
   - [ ] `createForm()` composition API
   - [ ] Multi-step forms
   - [ ] Dynamic field arrays
   - [ ] Conditional fields

4. **Testing** (Week 2)
   - [ ] Form unit tests
   - [ ] Validation tests
   - [ ] Multi-step tests

**Deliverables:**
- Forms module in `@omnitron-dev/aether/forms`
- Form examples
- Validation guide

---

### Phase 6: UI Primitives (3-4 weeks)

**Goal:** Headless, accessible UI components

**Tasks:**

1. **Core Primitives** (Week 1-2)
   - [ ] Dialog / Modal
   - [ ] Popover / Tooltip
   - [ ] Dropdown Menu
   - [ ] Select / Combobox
   - [ ] Tabs
   - [ ] Accordion

2. **Advanced Primitives** (Week 2-3)
   - [ ] Slider / Range
   - [ ] Toggle / Switch
   - [ ] RadioGroup / CheckboxGroup
   - [ ] Command Palette
   - [ ] DatePicker / Calendar
   - [ ] DataTable

3. **Accessibility** (Week 3)
   - [ ] ARIA attributes
   - [ ] Keyboard navigation
   - [ ] Focus management
   - [ ] Screen reader testing

4. **Testing** (Week 3-4)
   - [ ] Component tests
   - [ ] Accessibility tests (axe-core)
   - [ ] Keyboard navigation tests

**Deliverables:**
- Primitives module in `@omnitron-dev/aether/primitives`
- Primitive examples
- Accessibility guide

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
- 🔄 Compiler MVP (in progress - next phase)
- 🎯 Goal: Build Hello World app

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
