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

### Monorepo Layout

```
packages/
├── aether-core/              # Core runtime and reactivity system
│   ├── src/
│   │   ├── reactivity/      # Signal system (migrated from experiments/vibrancy)
│   │   │   ├── signal.ts
│   │   │   ├── computed.ts
│   │   │   ├── effect.ts
│   │   │   ├── store.ts
│   │   │   ├── resource.ts
│   │   │   ├── batch.ts
│   │   │   └── graph.ts     # Dependency tracking
│   │   ├── component/       # Component system
│   │   │   ├── define.ts
│   │   │   ├── lifecycle.ts
│   │   │   ├── context.ts
│   │   │   ├── props.ts
│   │   │   ├── refs.ts
│   │   │   └── events.ts
│   │   ├── directives/      # Directive system
│   │   │   ├── registry.ts
│   │   │   ├── lifecycle.ts
│   │   │   └── built-in/    # if, for, show, etc.
│   │   ├── runtime/         # Runtime utilities
│   │   │   ├── scheduler.ts
│   │   │   ├── hydration.ts
│   │   │   ├── islands.ts
│   │   │   └── ssr.ts
│   │   └── index.ts
│   ├── tests/               # Tests migrated from experiments/vibrancy
│   │   ├── reactivity/
│   │   ├── component/
│   │   └── directives/
│   └── package.json
│
├── aether-compiler/          # Template compiler and optimizer
│   ├── src/
│   │   ├── parser/          # TSX → AST
│   │   │   ├── lexer.ts
│   │   │   ├── parser.ts
│   │   │   └── ast.ts
│   │   ├── analyzer/        # Dependency analysis
│   │   │   ├── scope.ts
│   │   │   ├── reactive-deps.ts
│   │   │   └── static-analysis.ts
│   │   ├── transformer/     # AST transformations
│   │   │   ├── template.ts  # Template syntax → JS
│   │   │   ├── directives.ts
│   │   │   ├── component.ts
│   │   │   └── optimize.ts
│   │   ├── codegen/         # Code generation
│   │   │   ├── generator.ts
│   │   │   └── sourcemap.ts
│   │   ├── plugins/         # Plugin system
│   │   │   ├── vite.ts
│   │   │   └── webpack.ts
│   │   └── index.ts
│   ├── tests/
│   └── package.json
│
├── aether-di/                # Dependency injection system
│   ├── src/
│   │   ├── injectable.ts    # Function-based DI
│   │   ├── inject.ts
│   │   ├── container.ts
│   │   ├── scope.ts
│   │   ├── tokens.ts
│   │   ├── module.ts        # defineModule()
│   │   └── index.ts
│   ├── tests/
│   └── package.json
│
├── aether-router/            # File-based routing
│   ├── src/
│   │   ├── router.ts        # Core router
│   │   ├── route-matcher.ts
│   │   ├── file-scanner.ts  # Scan routes directory
│   │   ├── loader.ts        # Data loading
│   │   ├── action.ts        # Form actions
│   │   ├── navigation.ts    # Link, navigate()
│   │   ├── guards.ts        # Route guards
│   │   ├── prefetch.ts      # Prefetching
│   │   ├── layouts.ts       # Layout system
│   │   ├── error-boundary.ts
│   │   └── index.ts
│   ├── tests/
│   └── package.json
│
├── aether-forms/             # Form utilities and validation
│   ├── src/
│   │   ├── create-form.ts   # Form composition
│   │   ├── field.ts         # Field primitives
│   │   ├── validation/      # Validation engines
│   │   │   ├── validator.ts
│   │   │   ├── zod.ts
│   │   │   └── yup.ts
│   │   ├── transforms.ts
│   │   ├── multi-step.ts
│   │   └── index.ts
│   ├── tests/
│   └── package.json
│
├── aether-primitives/        # Headless UI primitives
│   ├── src/
│   │   ├── dialog/
│   │   ├── popover/
│   │   ├── dropdown/
│   │   ├── select/
│   │   ├── tabs/
│   │   ├── accordion/
│   │   ├── slider/
│   │   ├── command/
│   │   ├── calendar/
│   │   ├── table/
│   │   ├── utils/           # Accessibility utilities
│   │   └── index.ts
│   ├── tests/
│   └── package.json
│
├── aether-components/        # Styled component library
│   ├── src/
│   │   ├── button/
│   │   ├── input/
│   │   ├── card/
│   │   ├── alert/
│   │   ├── toast/
│   │   ├── navigation/
│   │   ├── layout/
│   │   ├── theme/           # Theming system
│   │   └── index.ts
│   ├── tests/
│   └── package.json
│
├── aether-netron/            # Netron RPC client
│   ├── src/
│   │   ├── client.ts        # WebSocket client
│   │   ├── proxy.ts         # Service proxy generator
│   │   ├── transport.ts
│   │   ├── reconnect.ts
│   │   ├── offline.ts
│   │   ├── optimistic.ts
│   │   └── index.ts
│   ├── tests/
│   └── package.json
│
├── aether-build/             # Build system and plugins
│   ├── src/
│   │   ├── vite/            # Vite plugin
│   │   ├── webpack/         # Webpack plugin (optional)
│   │   ├── ssr-renderer.ts
│   │   ├── ssg-generator.ts
│   │   ├── islands.ts
│   │   └── index.ts
│   ├── tests/
│   └── package.json
│
├── aether-cli/               # CLI tools
│   ├── src/
│   │   ├── commands/
│   │   │   ├── create.ts    # create-aether
│   │   │   ├── dev.ts
│   │   │   ├── build.ts
│   │   │   ├── deploy.ts
│   │   │   └── generate.ts
│   │   ├── templates/       # Project templates
│   │   └── index.ts
│   ├── tests/
│   └── package.json
│
├── aether-devtools/          # Browser DevTools extension
│   ├── src/
│   │   ├── panel/
│   │   ├── inspector/
│   │   ├── profiler/
│   │   └── index.ts
│   └── package.json
│
└── nexus/                   # Meta-package (re-exports everything)
    ├── src/
    │   └── index.ts
    └── package.json
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

Create the target directory in aether-core:

```bash
mkdir -p packages/aether-core/src/reactivity
mkdir -p packages/aether-core/tests/reactivity
```

#### Step 2: Migrate Source Files

Move and refactor files:

```bash
# Core reactivity primitives
experiments/vibrancy/src/signal.ts        → packages/aether-core/src/reactivity/signal.ts
experiments/vibrancy/src/computed.ts      → packages/aether-core/src/reactivity/computed.ts
experiments/vibrancy/src/effect.ts        → packages/aether-core/src/reactivity/effect.ts
experiments/vibrancy/src/store.ts         → packages/aether-core/src/reactivity/store.ts
experiments/vibrancy/src/resource.ts      → packages/aether-core/src/reactivity/resource.ts
experiments/vibrancy/src/batch.ts         → packages/aether-core/src/reactivity/batch.ts

# Dependency tracking
experiments/vibrancy/src/graph.ts         → packages/aether-core/src/reactivity/graph.ts
experiments/vibrancy/src/scheduler.ts     → packages/aether-core/src/reactivity/scheduler.ts

# Types and utilities
experiments/vibrancy/src/types.ts         → packages/aether-core/src/reactivity/types.ts
experiments/vibrancy/src/utils.ts         → packages/aether-core/src/reactivity/utils.ts
```

#### Step 3: Migrate Tests

```bash
# Test files
experiments/vibrancy/tests/*.spec.ts      → packages/aether-core/tests/reactivity/

# Test utilities
experiments/vibrancy/tests/helpers/       → packages/aether-core/tests/helpers/
```

#### Step 4: Update Import Paths

After migration, update all import paths:

```typescript
// OLD (experiments)
import { signal, computed } from 'experiments/vibrancy';

// NEW (aether-core)
import { signal, computed } from '@aether/core/reactivity';
// OR
import { signal, computed } from 'aether';
```

#### Step 5: Update Package Configuration

**packages/aether-core/package.json:**

```json
{
  "name": "@aether/core",
  "version": "0.1.0",
  "exports": {
    ".": "./dist/index.js",
    "./reactivity": "./dist/reactivity/index.js",
    "./component": "./dist/component/index.js",
    "./directives": "./dist/directives/index.js"
  },
  "types": "./dist/index.d.ts"
}
```

#### Step 6: Validation

Run migration validation:

```bash
# Run tests in new location
cd packages/aether-core
npm test

# Verify API compatibility
npm run test:api

# Check build
npm run build

# Verify exports
npm run test:exports
```

#### Step 7: Archive Experiments

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
  { from: 'experiments/vibrancy/src', to: 'packages/aether-core/src/reactivity' },
  { from: 'experiments/vibrancy/tests', to: 'packages/aether-core/tests/reactivity' }
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
        .replace(/from ['"]experiments\/vibrancy/g, "from '@aether/core/reactivity")
        .replace(/from ['"]\.\.\/vibrancy/g, "from '../reactivity");

      await fs.writeFile(targetPath, updated);
      console.log(`  ✓ ${file}`);
    }
  }

  console.log('\n✅ Migration complete!');
  console.log('\nNext steps:');
  console.log('1. Run tests: cd packages/aether-core && npm test');
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

1. **Migrate Vibrancy** (Week 1)
   - [ ] Execute migration script
   - [ ] Update all import paths
   - [ ] Validate tests pass
   - [ ] Update package.json exports

2. **Enhance Signal System** (Week 1-2)
   - [ ] Optimize signal performance
   - [ ] Add signal debugging utilities
   - [ ] Implement signal serialization (SSR)
   - [ ] Add TypeScript inference improvements

3. **Complete Reactivity Primitives** (Week 2)
   - [ ] Finalize `computed()` memoization
   - [ ] Complete `effect()` with cleanup
   - [ ] Implement `store()` with proxy-based reactivity
   - [ ] Add `resource()` for async data

4. **Dependency Graph** (Week 2-3)
   - [ ] Implement efficient dependency tracking
   - [ ] Add cycle detection
   - [ ] Optimize update batching
   - [ ] Create graph visualization utilities (for DevTools)

5. **Testing & Benchmarks** (Week 3)
   - [ ] Comprehensive unit tests (>95% coverage)
   - [ ] Performance benchmarks vs SolidJS/Vue
   - [ ] Memory leak detection tests
   - [ ] Edge case validation

**Deliverables:**
- `@aether/core` package with reactivity system
- Test suite with >95% coverage
- Performance benchmarks
- API documentation

---

### Phase 2: Component System & Compiler (3-4 weeks)

**Goal:** Component architecture and template compilation

**Tasks:**

1. **Component Runtime** (Week 1-2)
   - [ ] Implement `defineComponent()`
   - [ ] Lifecycle hooks (onMount, onCleanup, onUpdate)
   - [ ] Props with type inference
   - [ ] Context API (`createContext`, `useContext`)
   - [ ] Refs (`createRef`, `useRef`)
   - [ ] Event system

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
- `@aether/compiler` package
- `@aether/build` package with Vite plugin
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
- `@aether/di` package
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
- `@aether/router` package
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
- `@aether/forms` package
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
- `@aether/primitives` package
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
- `@aether/components` package
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
- `@aether/netron` package
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
- `@aether/cli` package
- `@aether/devtools` extension
- Testing utilities
- Documentation site

---

## Build Order and Dependencies

### Dependency Graph

```mermaid
graph TD
    A[aether-core] --> B[aether-compiler]
    A --> C[aether-di]
    A --> D[aether-router]
    A --> E[aether-forms]
    A --> F[aether-netron]

    B --> G[aether-build]
    C --> D
    C --> F

    A --> H[aether-primitives]
    H --> I[aether-components]

    G --> J[aether-cli]

    A --> K[nexus]
    B --> K
    C --> K
    D --> K
    E --> K
    F --> K
    H --> K
    I --> K
```

### Build Order

**Tier 1 (No dependencies):**
1. `aether-core` - Must be built first

**Tier 2 (Depends on core):**
2. `aether-compiler`
3. `aether-di`
4. `aether-primitives`

**Tier 3 (Depends on Tier 2):**
5. `aether-router` (depends on core + di)
6. `aether-forms` (depends on core)
7. `aether-netron` (depends on core + di)
8. `aether-build` (depends on core + compiler)
9. `aether-components` (depends on core + primitives)

**Tier 4 (Depends on Tier 3):**
10. `aether-cli` (depends on build)
11. `aether-devtools` (depends on all)
12. `nexus` (meta-package, depends on all)

### Automated Build Script

`scripts/build-order.ts`:

```typescript
#!/usr/bin/env node
import { execSync } from 'child_process';

const BUILD_ORDER = [
  // Tier 1
  ['aether-core'],
  // Tier 2
  ['aether-compiler', 'aether-di', 'aether-primitives'],
  // Tier 3
  ['aether-router', 'aether-forms', 'aether-netron', 'aether-build', 'aether-components'],
  // Tier 4
  ['aether-cli', 'aether-devtools', 'nexus']
];

async function buildAll() {
  for (const tier of BUILD_ORDER) {
    console.log(`\n🔨 Building tier: ${tier.join(', ')}\n`);

    // Build in parallel within tier
    const builds = tier.map(pkg => {
      return new Promise((resolve, reject) => {
        try {
          execSync(`cd packages/${pkg} && npm run build`, {
            stdio: 'inherit'
          });
          resolve(pkg);
        } catch (err) {
          reject(err);
        }
      });
    });

    await Promise.all(builds);
    console.log(`✅ Tier complete\n`);
  }

  console.log('🎉 All packages built successfully!');
}

buildAll().catch(err => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
```

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

**Per Package:**

```typescript
// packages/aether-core/tests/reactivity/signal.spec.ts
import { signal } from '../../src/reactivity/signal';

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
// packages/aether-core/benchmarks/signal.bench.ts
import { bench, describe } from 'vitest';
import { signal } from '../src/reactivity/signal';

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

| Package | Unit | Integration | E2E |
|---------|------|-------------|-----|
| aether-core | 95%+ | 80%+ | - |
| aether-compiler | 90%+ | 85%+ | - |
| aether-di | 95%+ | 80%+ | - |
| aether-router | 90%+ | 85%+ | 70%+ |
| aether-forms | 90%+ | 80%+ | 70%+ |
| aether-primitives | 85%+ | 80%+ | 75%+ |
| aether-components | 80%+ | - | - |
| aether-netron | 90%+ | 85%+ | - |

---

## Tooling and Infrastructure

### Development Tools

**Monorepo:**
- Turborepo - Build orchestration
- Yarn Workspaces - Package management
- Changesets - Version management

**Build:**
- TypeScript - Type checking and compilation
- Vite - Dev server and bundling
- ESBuild - Fast builds

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
- Changesets - Automated releases
- npm - Package publishing

### Repository Configuration

**Root `package.json`:**

```json
{
  "name": "aether-monorepo",
  "private": true,
  "workspaces": [
    "packages/*",
    "apps/*"
  ],
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "test": "turbo run test",
    "test:e2e": "turbo run test:e2e",
    "lint": "turbo run lint",
    "format": "prettier --write \"**/*.{ts,tsx,md}\"",
    "changeset": "changeset",
    "version": "changeset version",
    "release": "turbo run build && changeset publish"
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
- ✅ Vibrancy migration complete
- ✅ Core reactivity system stable
- ✅ Component system working
- ✅ Compiler MVP
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

1. **Setup monorepo structure:**
   ```bash
   mkdir -p packages/{aether-core,aether-compiler,aether-di,aether-router,aether-forms,aether-primitives,aether-components,aether-netron,aether-build,aether-cli,aether-devtools,nexus}
   ```

2. **Execute Vibrancy migration:**
   ```bash
   node scripts/migrate-vibrancy.ts
   ```

3. **Initialize packages:**
   - Create package.json for each
   - Setup tsconfig.json
   - Configure build scripts

4. **Setup tooling:**
   - Initialize Turborepo
   - Configure ESLint/Prettier
   - Setup GitHub Actions

### Week 2 Goals

- ✅ Vibrancy fully migrated and tests passing
- ✅ aether-core builds successfully
- ✅ Basic signal example working
- ✅ Documentation site skeleton

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
