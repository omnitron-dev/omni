# Aether Framework — Full Specification

> Minimalist, high-performance frontend framework with deep Titan integration

## Table of Contents

### Part I: Foundational Concepts

1. [01-PHILOSOPHY.md](./01-PHILOSOPHY.md) — Philosophy and Design Principles
   - Minimalism and cognitive load
   - Compile-time optimizations
   - Principle of least surprise
   - Zero configuration
   - Progressive enhancement

2. [02-REACTIVITY.md](./02-REACTIVITY.md) — Granular Reactivity System
   - Signals: atomic reactive primitives
   - Computed: derived values with memoization
   - Effects: side effects with automatic tracking
   - Stores: nested reactivity for complex objects
   - Dependency graph and update algorithm
   - Batching and performance optimizations
   - Compiler integration

3. [03-COMPONENTS.md](./03-COMPONENTS.md) — Component Architecture
   - Defining components via defineComponent
   - Component lifecycle
   - Props: typed properties
   - Slots: composition and content projection
   - Events: emitting and handling events
   - Refs: access to DOM elements
   - Context: passing data through the tree
   - Dynamic Components: dynamic loading

### Part II: Templates and DSL

4. [04-TEMPLATE-SYNTAX.md](./04-TEMPLATE-SYNTAX.md) — Template Language
   - Interpolation: `{expression}`
   - Directives:
     - `nx:if`, `nx:else-if`, `nx:else` — conditional rendering
     - `nx:for` — iterating collections
     - `nx:show` — CSS-based visibility
   - Attributes:
     - `on:event` — event handlers with modifiers
     - `bind:value` — two-way binding
     - `class:name` — conditional classes
     - `style:property` — dynamic styles
     - `use:action` — action directives
     - `transition:name` — transition animations
   - Special elements: `<For>`, `<Show>`, `<Await>`, `<Portal>`

5. [05-DIRECTIVES.md](./05-DIRECTIVES.md) — Directive System
   - Built-in directives
   - Creating custom directives
   - Directive lifecycle
   - Directive parameterization
   - Directive composition

### Part III: Modular Architecture

6. [06-MODULES.md](./06-MODULES.md) — Modular System (Angular-inspired)
   - Module concept
   - Feature modules
   - Shared modules
   - Core module
   - Lazy-loaded modules
   - Module providers and DI scope
   - Module composition
   - Barrel exports

7. [07-DEPENDENCY-INJECTION.md](./07-DEPENDENCY-INJECTION.md) — Dependency Injection
   - Injectable services
   - DI tokens and InjectionToken
   - Scopes: singleton, transient, request
   - Providers: useClass, useFactory, useValue
   - Hierarchical injection
   - Optional dependencies
   - Integration with Titan DI
   - Tree-shakeable providers

### Part IV: Routing and Navigation

8. [08-ROUTING.md](./08-ROUTING.md) — File-based Routing
   - File structure and conventions
   - Dynamic routes: `[param]`, `[...rest]`
   - Route groups: `(group)`
   - Layouts: `+layout.tsx`
   - Error boundaries: `+error.tsx`
   - Loading states: `+loading.tsx`
   - Loaders and Actions
   - Route typing
   - Navigation: Link, navigate, redirect
   - Route guards and middleware
   - Prefetching strategies

9. [09-DATA-LOADING.md](./09-DATA-LOADING.md) — Data Loading
   - Loaders: SSR data fetching
   - Actions: data mutations
   - Resources: asynchronous resources
   - Deferred: transitions with previous data
   - Streaming SSR
   - Optimistic updates
   - Caching and invalidation
   - Parallel loading

### Part V: State Management

10. [10-STATE-MANAGEMENT.md](./10-STATE-MANAGEMENT.md) — State Management
    - Local state (signals)
    - Global stores
    - Context API
    - Persist state (localStorage, sessionStorage)
    - State machines (XState integration)
    - Immutability helpers
    - Undo/Redo patterns
    - DevTools integration

### Part VI: Styling and Theming

11. [11-STYLING.md](./11-STYLING.md) — Styling System
    - Scoped styles
    - CSS Modules
    - CSS-in-JS (optional)
    - Global styles
    - CSS Variables
    - PostCSS and plugins
    - Tailwind CSS integration

12. [12-THEMING.md](./12-THEMING.md) — Theming System (from specs/02.md)
    - Design tokens
    - Defining themes: `defineTheme()`
    - Theme inheritance
    - Dark/Light mode
    - Runtime theme switching
    - CSS Variables generation
    - TypeScript typing for tokens
    - Adaptive themes (responsive theming)

### Part VII: UI Primitives

13. [13-PRIMITIVES/README.md](./13-PRIMITIVES/README.md) — Headless UI Primitives (shadcn-like)
    - Headless component philosophy
    - Accessibility built-in by default
    - List of primitives:
      - Dialog / Modal
      - Popover / Tooltip
      - Dropdown Menu
      - Select / Combobox
      - Tabs
      - Accordion
      - RadioGroup / CheckboxGroup
      - Slider / Range
      - Toggle / Switch
      - AlertDialog
      - Sheet / Drawer
      - Command Palette
      - DatePicker / Calendar
      - Form / Field
      - Table / DataTable
    - Composition of primitives
    - Customization and extension

14. [14-COMPONENTS-LIBRARY.md](./14-COMPONENTS-LIBRARY.md) — Ready-to-Use Components Library
    - Styled components built on top of primitives
    - Button, Input, Textarea, Select
    - Card, Badge, Avatar
    - Alert, Toast, Notification
    - Pagination, Breadcrumbs
    - Spinner, Progress, Skeleton
    - Navigation, Sidebar, Header
    - Grid, Stack, Flex
    - Component theming

### Part VIII: Forms and Validation

15. [15-FORMS.md](./15-FORMS.md) — Working with Forms
    - Form primitives
    - Field-level validation
    - Form-level validation
    - Async validation
    - Schema validation (Zod, Yup)
    - Error handling
    - Form state management
    - Touched/Dirty tracking
    - Submit handling
    - File uploads
    - Multi-step forms

### Part IX: SSR and Islands

16. [16-SSR.md](./16-SSR.md) — Server-Side Rendering
    - SSR architecture
    - Hydration vs Resumability
    - Streaming SSR
    - Data serialization
    - SEO optimization
    - Meta tags management
    - Open Graph
    - Performance metrics

17. [17-ISLANDS.md](./17-ISLANDS.md) — Islands Architecture
    - Concept of islands of interactivity
    - Island modes:
      - `static` — HTML only, 0KB JS
      - `eager` — immediate loading
      - `visible` — load when visible
      - `idle` — load in idle time
      - `interaction` — load on interaction
    - Partial Hydration
    - Island boundaries
    - Communication between islands
    - Performance implications

18. [18-SSG.md](./18-SSG.md) — Static Site Generation
    - Prerendering routes
    - Dynamic route generation
    - Incremental Static Regeneration (ISR)
    - Build-time data fetching
    - Hybrid SSR/SSG
    - Deployment strategies

### Part X: Titan Integration

19. [19-TITAN-INTEGRATION.md](./19-TITAN-INTEGRATION.md) — Deep Titan Integration
    - Interaction architecture
    - Shared services
    - Unified DI container
    - Type-safe RPC via Netron
    - WebSocket real-time
    - Database access in loaders
    - Authentication flow
    - Authorization guards
    - Session management
    - API routes as Titan endpoints

20. [20-NETRON-RPC.md](./20-NETRON-RPC.md) — RPC via Netron
    - Service definitions
    - Auto-generated clients
    - Type safety
    - Streaming responses
    - Error handling
    - Retry logic
    - Offline support
    - Optimistic updates

### Part XI: Build System and Compiler

21. [21-BUILD-SYSTEM.md](./21-BUILD-SYSTEM.md) — Build System
    - Vite integration
    - Development server
    - Hot Module Replacement (HMR)
    - Production build
    - Code splitting strategies
    - Bundle optimization
    - Asset handling
    - Source maps
    - Build plugins

22. [22-COMPILER.md](./22-COMPILER.md) — Compiler and Optimizations
    - Parser: TSX → AST
    - Analyzer: dependency tracking
    - Transformer: high-level constructs → low-level
    - Optimizer: dead code elimination, constant folding
    - Code Generator: AST → optimal JS
    - Compile-time execution
    - Template hoisting and effect batching
    - Plugin API

### Part XII: Developer Experience

23. [23-TESTING.md](./23-TESTING.md) — Testing
    - Component unit testing
    - Integration testing
    - E2E testing
    - Testing utilities
    - Mocking dependencies
    - Snapshot testing
    - Coverage reporting
    - Visual regression testing

24. [24-DEBUGGING.md](./24-DEBUGGING.md) — Debugging
    - Browser DevTools integration
    - Reactivity graph visualization
    - Component tree inspector
    - Performance profiling
    - Memory leak detection
    - Source maps
    - Error boundaries
    - Error reporting

25. [25-PERFORMANCE.md](./25-PERFORMANCE.md) — Performance Best Practices
    - Bundle size optimization
    - Lazy loading strategies
    - Code splitting recommendations
    - Image optimization
    - Caching strategies
    - Prefetching
    - Web Vitals optimization
    - Lighthouse scoring

26. [26-ACCESSIBILITY.md](./26-ACCESSIBILITY.md) — Accessibility (a11y)
    - ARIA attributes
    - Keyboard navigation
    - Screen reader support
    - Focus management
    - Color contrast
    - Semantic HTML
    - Accessibility testing
    - WCAG compliance

### Part XIII: Deployment and Production

27. [27-DEPLOYMENT.md](./27-DEPLOYMENT.md) — Deployment
    - Static hosting (Vercel, Netlify, Cloudflare Pages)
    - Node.js server
    - Docker containers
    - Kubernetes
    - Edge functions
    - CDN configuration
    - Environment variables
    - CI/CD pipelines

28. [28-MONITORING.md](./28-MONITORING.md) — Monitoring
    - Error tracking (Sentry)
    - Performance monitoring
    - Real User Monitoring (RUM)
    - Logging
    - Metrics
    - Alerting
    - Health checks

29. [29-SECURITY.md](./29-SECURITY.md) — Security
    - XSS prevention
    - CSRF protection
    - Content Security Policy
    - Authentication best practices
    - Authorization patterns
    - Secure headers
    - Dependency scanning
    - Security auditing

30. [30-PWA.md](./30-PWA.md) — Progressive Web Apps
    - Web App Manifest
    - Service Workers
    - Offline strategies
    - Background sync
    - Push notifications
    - App installation
    - Cache strategies
    - PWA best practices

### Part XIV: Advanced Features

31. [31-INTERNATIONALIZATION.md](./31-INTERNATIONALIZATION.md) — Internationalization (i18n)
    - Translation management
    - Locale detection
    - Message formatting
    - Pluralization
    - Date/time formatting
    - Number formatting
    - RTL support
    - Dynamic locale loading

32. [32-SEO.md](./32-SEO.md) — Search Engine Optimization
    - Meta tags management
    - Open Graph
    - Twitter Cards
    - Structured data
    - Sitemap generation
    - Robots.txt
    - Canonical URLs
    - SEO best practices

33. [33-ANALYTICS.md](./33-ANALYTICS.md) — Analytics
    - User analytics integration
    - Event tracking
    - Conversion tracking
    - Custom dimensions
    - Privacy compliance
    - Analytics providers
    - Performance metrics
    - A/B testing

34. [34-ERROR-HANDLING.md](./34-ERROR-HANDLING.md) — Error Handling
    - Error boundaries
    - Global error handling
    - Async error handling
    - Error logging
    - User-friendly error messages
    - Recovery strategies
    - Error monitoring integration
    - Development vs production errors

### Part XV: Migration and Ecosystem

35. [35-MIGRATION.md](./35-MIGRATION.md) — Migration Guide
    - From React
    - From Vue
    - From Svelte
    - From Angular
    - From SolidJS
    - Migration strategies
    - Incremental adoption

36. [36-ECOSYSTEM.md](./36-ECOSYSTEM.md) — Ecosystem
    - Official packages
    - Community packages
    - Integrations with external libraries
    - Plugin development
    - Third-party components
    - UI libraries integration

### Part XVI: Practical Guides

37. [37-COOKBOOK.md](./37-COOKBOOK.md) — Cookbook (Recipes and How-Tos)
    - Authentication and authorization
    - Dark mode implementation
    - File uploads
    - Infinite scroll
    - Virtual lists
    - Form wizards
    - Drag & Drop
    - Charts and graphs
    - Maps integration
    - Real-time features

### Appendices

38. [38-API-REFERENCE.md](./38-API-REFERENCE.md) — Complete API Reference
    - Core APIs
    - Function signatures
    - Interfaces and types
    - Constants and enums
    - Type utilities
    - Compiler directives

39. [39-FAQ.md](./39-FAQ.md) — Frequently Asked Questions

40. [40-ROADMAP.md](./40-ROADMAP.md) — Roadmap

---

## Aether Key Principles

### 1. Minimalism

Every line of code must have a purpose. No boilerplate, no redundancy.

```typescript
// Counter.tsx
import { defineComponent, signal } from 'aether';

export const Counter = defineComponent(() => {
  const count = signal(0);

  return () => (
    <button on:click={() => count.update(n => n + 1)}>
      {count()}
    </button>
  );
});
```

### 2. Performance

- Bundle Size: Hello World = 1.2KB, TodoMVC = 6KB
- Time to Interactive: ~30ms (resumable, no hydration required)
- Runtime Overhead: Zero — everything compiles to optimal imperative code

### 3. Type Safety

TypeScript first. Full type inference everywhere.

```typescript
// Automatic typing
const user = signal<User | null>(null);
const name = computed(() => user()?.name ?? 'Guest'); // string
```

### 4. Titan-Native

A unified full-stack application. One language, one toolchain.

```typescript
// One service for frontend and backend
@Injectable()
@Service('users@1.0.0')
export class UserService {
  @Public()
  async findAll(): Promise<User[]> {
    // Backend: database query
    // Frontend: RPC call
  }
}
```

### 5. Progressive Enhancement

Static first. JavaScript only where needed.

```typescript
// Static component — 0KB JS
export const mode = 'static';

// Interactive only when visible
export const mode = 'visible';
```

---

## Performance Metrics

| Metric | Aether | Qwik | Svelte | SolidJS | Vue 3 | React 18 |
|--------|-------|------|--------|---------|-------|----------|
| Bundle Size (Hello World) | 1.2KB | 1KB | 2KB | 7KB | 34KB | 42KB |
| Bundle Size (TodoMVC) | 6KB | 8KB | 12KB | 18KB | 134KB | 156KB |
| Time to Interactive | ~30ms | ~50ms | ~200ms | ~150ms | ~400ms | ~500ms |
| Runtime Overhead | 0% | ~5% | ~10% | ~15% | ~40% | ~50% |
| Hydration | None | None | Required | Required | Required | Required |

---

## Getting Started

```bash
# Create a project
npx create-aether my-app
cd my-app

# Development
npm run dev

# Production build
npm run build

# Deploy to Titan
npm run deploy
```

---

This specification is a comprehensive guide to the Aether Framework. Each file contains an in-depth description of the respective aspect of the framework, including code examples, best practices, and detailed explanations of internal mechanics.