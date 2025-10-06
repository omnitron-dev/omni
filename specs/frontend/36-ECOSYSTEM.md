# 36. Ecosystem and Plugins

## Table of Contents
- [Overview](#overview)
- [Official Plugins](#official-plugins)
- [Community Plugins](#community-plugins)
- [Creating Plugins](#creating-plugins)
- [Plugin Architecture](#plugin-architecture)
- [Vite Plugins](#vite-plugins)
- [UI Component Libraries](#ui-component-libraries)
- [State Management](#state-management)
- [Routing](#routing)
- [Form Libraries](#form-libraries)
- [Data Fetching](#data-fetching)
- [Animation](#animation)
- [Testing](#testing)
- [DevTools](#devtools)
- [Publishing Plugins](#publishing-plugins)
- [Best Practices](#best-practices)

## Overview

Nexus has a growing ecosystem of plugins and integrations.

### Ecosystem Philosophy

```typescript
/**
 * Nexus Ecosystem Principles:
 *
 * 1. Modularity
 *    - Small, focused packages
 *    - Composable plugins
 *    - Tree-shakeable
 *
 * 2. Integration
 *    - Works with Titan backend
 *    - Compatible with Vite
 *    - Standard APIs
 *
 * 3. Quality
 *    - TypeScript-first
 *    - Well-documented
 *    - Tested
 *
 * 4. Performance
 *    - Minimal overhead
 *    - Optimized bundles
 *    - SSR-compatible
 *
 * 5. Developer Experience
 *    - Easy to use
 *    - Great TypeScript support
 *    - Clear examples
 */
```

## Official Plugins

Core plugins maintained by Nexus team.

### @nexus/router

File-based routing with data loading.

```bash
npm install @nexus/router
```

```typescript
// Auto-generated from file structure
import { Router } from '@nexus/router';

export default defineComponent(() => {
  return () => <Router />;
});

// routes/
// ├── index.tsx           → /
// ├── about.tsx           → /about
// └── blog/
//     ├── [slug].tsx      → /blog/:slug
//     └── index.tsx       → /blog
```

### @nexus/forms

Powerful form management and validation.

```bash
npm install @nexus/forms zod
```

```typescript
import { createForm } from '@nexus/forms';
import { z } from 'zod';

const form = createForm({
  initialValues: { email: '', password: '' },
  validate: z.object({
    email: z.string().email(),
    password: z.string().min(8)
  }),
  onSubmit: async (values) => {
    await login(values);
  }
});
```

### @nexus/i18n

Internationalization and localization.

```bash
npm install @nexus/i18n
```

```typescript
import { createI18n } from '@nexus/i18n';

const i18n = createI18n({
  locale: 'en',
  messages: {
    en: { hello: 'Hello' },
    es: { hello: 'Hola' }
  }
});

// Usage
const { t } = useI18n();
t('hello'); // "Hello"
```

### @nexus/query

Advanced data fetching and caching.

```bash
npm install @nexus/query
```

```typescript
import { createQuery } from '@nexus/query';

const user = createQuery({
  queryKey: ['user', userId],
  queryFn: () => fetchUser(userId),
  staleTime: 60000
});
```

### @nexus/devtools

Development tools and debugging.

```bash
npm install -D @nexus/devtools
```

```typescript
import { enableDevTools } from '@nexus/devtools';

if (import.meta.env.DEV) {
  enableDevTools();
}
```

## Community Plugins

Popular third-party plugins.

### UI Component Libraries

```bash
# shadcn/ui for Nexus
npm install @nexus-ui/core

# Headless UI
npm install @headlessui/solid

# Kobalte (Solid UI)
npm install @kobalte/core
```

### Animation

```bash
# Motion One
npm install motion

# Auto Animate
npm install @formkit/auto-animate

# Framer Motion for Solid
npm install solid-motionone
```

### Charts and Data Viz

```bash
# Chart.js
npm install chart.js solid-chartjs

# D3.js
npm install d3

# Recharts
npm install solid-recharts
```

### Icons

```bash
# Iconify
npm install @iconify/solid

# Heroicons
npm install solid-heroicons

# Lucide Icons
npm install lucide-solid
```

## Creating Plugins

Build your own Nexus plugins.

### Plugin Structure

```typescript
// my-plugin/src/index.ts
import { Plugin } from '@nexus/core';

export interface MyPluginOptions {
  apiKey: string;
  debug?: boolean;
}

export const myPlugin = (options: MyPluginOptions): Plugin => {
  return {
    name: 'my-plugin',
    version: '1.0.0',

    // Called when plugin is installed
    install(app) {
      // Add global properties
      app.provide('myPlugin', {
        doSomething: () => {
          console.log('Doing something');
        }
      });

      // Register components
      app.component('MyComponent', MyComponent);

      // Add directives
      app.directive('my-directive', myDirective);
    },

    // Vite plugin integration
    vite: {
      name: 'vite-plugin-my-plugin',
      configResolved(config) {
        // Configure Vite
      },
      transformIndexHtml(html) {
        // Transform HTML
        return html;
      }
    }
  };
};

// Usage
import { createApp } from '@nexus/core';
import { myPlugin } from 'my-plugin';

const app = createApp(App);
app.use(myPlugin({ apiKey: 'xxx' }));
```

### Plugin with Composable

```typescript
// plugin/src/composable.ts
import { signal, computed, onCleanup } from '@nexus/core';

export interface UseMyPluginOptions {
  initialValue?: string;
}

export const useMyPlugin = (options?: UseMyPluginOptions) => {
  const value = signal(options?.initialValue || '');
  const uppercase = computed(() => value().toUpperCase());

  const doSomething = () => {
    console.log('Doing something with:', value());
  };

  // Cleanup
  onCleanup(() => {
    console.log('Cleaning up');
  });

  return {
    value,
    setValue,
    uppercase,
    doSomething
  };
};

// plugin/src/index.ts
export { useMyPlugin } from './composable';

export const MyPluginModule = defineModule({
  providers: [
    // Services, etc.
  ]
});
```

### Component Plugin

```typescript
// plugin/src/Button.tsx
import { defineComponent } from '@nexus/core';

export const Button = defineComponent((props: {
  variant?: 'primary' | 'secondary';
  onClick?: () => void;
}) => {
  return () => (
    <button
      class={`btn btn-${props.variant || 'primary'}`}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
});

// plugin/src/index.ts
export { Button } from './Button';
export { Input } from './Input';
export { Card } from './Card';

// Auto-import plugin
export const components = {
  Button,
  Input,
  Card
};

// Usage
import { Button } from 'my-ui-library';
```

## Plugin Architecture

Plugin system design.

### Plugin API

```typescript
// Core plugin interface
export interface Plugin {
  name: string;
  version?: string;

  // Installation hook
  install?(app: App, options?: any): void;

  // Vite integration
  vite?: PluginOption | PluginOption[];

  // Configuration
  config?: PluginConfig;

  // Dependencies
  dependencies?: string[];

  // Lifecycle hooks
  beforeMount?(): void;
  afterMount?(): void;
  beforeUnmount?(): void;
}

// Plugin configuration
export interface PluginConfig {
  // SSR support
  ssr?: boolean;

  // Client-only
  clientOnly?: boolean;

  // Auto-import components
  autoImport?: boolean;

  // Global styles
  styles?: string[];
}
```

### Plugin Registration

```typescript
// App with plugins
import { createApp } from '@nexus/core';
import { router } from '@nexus/router';
import { i18n } from '@nexus/i18n';
import { analytics } from './plugins/analytics';

const app = createApp(App);

// Register plugins
app.use(router);
app.use(i18n, { locale: 'en' });
app.use(analytics, { trackingId: 'GA-XXX' });

// Mount app
app.mount('#app');
```

### Plugin Context

```typescript
// Access plugin context
export const MyComponent = defineComponent(() => {
  // Inject plugin services
  const analytics = inject(AnalyticsService);
  const i18n = useI18n();

  const handleClick = () => {
    analytics.track('button_click');
  };

  return () => (
    <button onClick={handleClick}>
      {i18n.t('click_me')}
    </button>
  );
});
```

## Vite Plugins

Integrate with Vite build system.

### Custom Vite Plugin

```typescript
// vite-plugin-my-feature.ts
import { Plugin } from 'vite';

export function myFeaturePlugin(options?: { enabled?: boolean }): Plugin {
  return {
    name: 'vite-plugin-my-feature',

    // Resolve imports
    resolveId(id) {
      if (id === 'virtual:my-feature') {
        return '\0virtual:my-feature';
      }
    },

    // Load virtual modules
    load(id) {
      if (id === '\0virtual:my-feature') {
        return `export const feature = ${JSON.stringify(options)}`;
      }
    },

    // Transform code
    transform(code, id) {
      if (id.endsWith('.my-ext')) {
        return {
          code: transformMyCode(code),
          map: null
        };
      }
    },

    // Configure server
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Custom middleware
        next();
      });
    },

    // Build hooks
    buildStart() {
      console.log('Build starting');
    },

    buildEnd() {
      console.log('Build complete');
    }
  };
}

// vite.config.ts
import { defineConfig } from 'vite';
import { myFeaturePlugin } from './vite-plugin-my-feature';

export default defineConfig({
  plugins: [
    myFeaturePlugin({ enabled: true })
  ]
});
```

### Virtual Modules

```typescript
// Create virtual module
// vite-plugin-routes.ts
export function routesPlugin(): Plugin {
  return {
    name: 'vite-plugin-routes',

    resolveId(id) {
      if (id === 'virtual:routes') {
        return '\0virtual:routes';
      }
    },

    load(id) {
      if (id === '\0virtual:routes') {
        const routes = generateRoutes();
        return `export default ${JSON.stringify(routes)}`;
      }
    }
  };
}

// Usage in app
import routes from 'virtual:routes';
```

## UI Component Libraries

Pre-built component libraries.

### Nexus UI (Official)

```bash
npm install @nexus-ui/core
```

```typescript
import { Button, Input, Card, Dialog } from '@nexus-ui/core';
import '@nexus-ui/core/styles.css';

export default defineComponent(() => {
  return () => (
    <Card>
      <Card.Header>
        <Card.Title>Sign Up</Card.Title>
      </Card.Header>
      <Card.Content>
        <Input label="Email" type="email" />
        <Input label="Password" type="password" />
      </Card.Content>
      <Card.Footer>
        <Button variant="primary">Submit</Button>
      </Card.Footer>
    </Card>
  );
});
```

### Headless UI

```bash
npm install @headlessui/solid
```

```typescript
import { Dialog, Transition } from '@headlessui/solid';

export const Modal = defineComponent((props: { open: boolean }) => {
  return () => (
    <Transition show={props.open}>
      <Dialog onClose={() => setOpen(false)}>
        <Dialog.Panel>
          <Dialog.Title>Modal Title</Dialog.Title>
          <Dialog.Description>
            Modal content
          </Dialog.Description>
        </Dialog.Panel>
      </Dialog>
    </Transition>
  );
});
```

## State Management

Advanced state management solutions.

### Nexus Store (Built-in)

```typescript
import { createStore } from '@nexus/core';

const [state, setState] = createStore({
  user: null,
  cart: []
});

// Mutations
setState('user', user);
setState('cart', [...state.cart, item]);
```

### Zustand (Adapted)

```bash
npm install zustand
```

```typescript
import create from 'zustand';

const useStore = create((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 }))
}));

// Usage
const count = useStore((state) => state.count);
```

### Jotai (Atoms)

```bash
npm install jotai
```

```typescript
import { atom, useAtom } from 'jotai';

const countAtom = atom(0);

export const Counter = defineComponent(() => {
  const [count, setCount] = useAtom(countAtom);

  return () => (
    <button onClick={() => count.set(count() + 1)}>
      {count()}
    </button>
  );
});
```

## Routing

Router alternatives and extensions.

### @nexus/router (Official)

File-based routing with loaders.

```typescript
// routes/blog/[slug].tsx
export const loader = async ({ params }) => {
  return await fetchPost(params.slug);
};

export default defineRoute({
  loader,
  component: defineComponent(() => {
    const post = useLoaderData();
    return () => <Article post={post()} />;
  })
});
```

### @solidjs/router (Adapted)

Component-based routing.

```bash
npm install @solidjs/router
```

```typescript
import { Router, Route } from '@solidjs/router';

export default defineComponent(() => {
  return () => (
    <Router>
      <Route path="/" component={Home} />
      <Route path="/about" component={About} />
      <Route path="/blog/:id" component={BlogPost} />
    </Router>
  );
});
```

## Form Libraries

Form handling solutions.

### @nexus/forms (Official)

Type-safe form validation.

```typescript
import { createForm } from '@nexus/forms';
import { z } from 'zod';

const form = createForm({
  initialValues: { email: '' },
  validate: z.object({
    email: z.string().email()
  }),
  onSubmit: async (values) => {
    await submit(values);
  }
});
```

### Modular Forms

```bash
npm install @modular-forms/solid
```

```typescript
import { createForm } from '@modular-forms/solid';

const [form, { Form, Field }] = createForm({
  initialValues: { email: '' }
});
```

## Data Fetching

Data fetching and caching.

### @nexus/query (Official)

React Query for Nexus.

```typescript
import { createQuery, createMutation } from '@nexus/query';

const user = createQuery({
  queryKey: ['user', userId],
  queryFn: () => fetchUser(userId)
});

const updateUser = createMutation({
  mutationFn: (data) => updateUser(userId, data),
  onSuccess: () => {
    queryClient.invalidateQueries(['user', userId]);
  }
});
```

### SWR (Adapted)

```bash
npm install swr
```

```typescript
import useSWR from 'swr';

const { data, error, mutate } = useSWR('/api/user', fetcher);
```

## Animation

Animation libraries.

### Motion One

```bash
npm install motion
```

```typescript
import { animate } from 'motion';

export const AnimatedBox = defineComponent(() => {
  let boxRef: HTMLDivElement;

  onMount(() => {
    animate(boxRef, { x: 100 }, { duration: 1 });
  });

  return () => <div ref={boxRef}>Animated</div>;
});
```

### Auto Animate

```bash
npm install @formkit/auto-animate
```

```typescript
import autoAnimate from '@formkit/auto-animate';

export const List = defineComponent(() => {
  let listRef: HTMLUListElement;

  onMount(() => {
    autoAnimate(listRef);
  });

  return () => (
    <ul ref={listRef}>
      <For each={items()}>
        {(item) => <li>{item}</li>}
      </For>
    </ul>
  );
});
```

## Testing

Testing tools and utilities.

### @nexus/testing (Official)

Testing utilities for Nexus.

```bash
npm install -D @nexus/testing
```

```typescript
import { render, fireEvent } from '@nexus/testing';

test('increments counter', async () => {
  const { getByText } = render(() => <Counter />);
  await fireEvent.click(getByText('Increment'));
  expect(getByText('Count: 1')).toBeInTheDocument();
});
```

### Testing Library

```bash
npm install -D @testing-library/solid
```

```typescript
import { render, fireEvent } from '@testing-library/solid';
```

## DevTools

Development and debugging tools.

### @nexus/devtools (Official)

Browser DevTools extension.

```typescript
import { enableDevTools } from '@nexus/devtools';

if (import.meta.env.DEV) {
  enableDevTools({
    inspector: true,
    performance: true,
    state: true
  });
}
```

### Features

```typescript
/**
 * DevTools Features:
 *
 * 1. Component Inspector
 *    - View component tree
 *    - Inspect props and state
 *    - Highlight components
 *
 * 2. Performance Monitor
 *    - Track render times
 *    - Identify bottlenecks
 *    - Memory profiling
 *
 * 3. State Debugger
 *    - View signal values
 *    - Track state changes
 *    - Time-travel debugging
 *
 * 4. Network Inspector
 *    - Monitor API requests
 *    - View responses
 *    - Track loading states
 */
```

## Publishing Plugins

Share your plugins with the community.

### Package Structure

```
my-plugin/
├── src/
│   ├── index.ts
│   ├── composable.ts
│   └── components/
├── dist/
├── package.json
├── README.md
├── LICENSE
└── tsconfig.json
```

### package.json

```json
{
  "name": "@username/nexus-plugin-name",
  "version": "1.0.0",
  "description": "Description of your plugin",
  "keywords": ["nexus", "plugin", "your-keywords"],
  "author": "Your Name",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/username/nexus-plugin-name"
  },
  "main": "./dist/index.js",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsup src/index.ts --format cjs,esm --dts",
    "prepublishOnly": "npm run build"
  },
  "peerDependencies": {
    "@nexus/core": "^1.0.0"
  },
  "devDependencies": {
    "@nexus/core": "^1.0.0",
    "tsup": "^8.0.0",
    "typescript": "^5.3.0"
  }
}
```

### README Template

```markdown
# @username/nexus-plugin-name

Description of your plugin.

## Installation

```bash
npm install @username/nexus-plugin-name
```

## Usage

```typescript
import { myPlugin } from '@username/nexus-plugin-name';

const app = createApp(App);
app.use(myPlugin, { /* options */ });
```

## API

### `myPlugin(options)`

Options:
- `option1` (string): Description
- `option2` (boolean): Description

### `useMyPlugin()`

Returns:
- `value`: Current value
- `setValue`: Update value

## Examples

[Examples here]

## License

MIT
```

### Publishing

```bash
# Build package
npm run build

# Test locally
npm link
cd ../test-project
npm link @username/nexus-plugin-name

# Publish to npm
npm publish --access public
```

## Best Practices

Plugin development guidelines.

### Guidelines

```typescript
/**
 * Plugin Best Practices:
 *
 * 1. TypeScript First
 *    - Full type definitions
 *    - Export types
 *    - Type-safe options
 *
 * 2. Tree-Shakeable
 *    - Use ES modules
 *    - Avoid side effects
 *    - Export granularly
 *
 * 3. SSR Compatible
 *    - Check for browser APIs
 *    - Provide SSR stubs
 *    - Test in SSR mode
 *
 * 4. Well Documented
 *    - Clear README
 *    - API documentation
 *    - Examples
 *
 * 5. Tested
 *    - Unit tests
 *    - Integration tests
 *    - E2E tests
 *
 * 6. Performant
 *    - Minimal overhead
 *    - Optimized bundles
 *    - Lazy loading
 *
 * 7. Accessible
 *    - ARIA support
 *    - Keyboard navigation
 *    - Screen reader friendly
 *
 * 8. Versioned
 *    - Semantic versioning
 *    - Changelog
 *    - Migration guides
 */
```

### Example Plugin Template

```typescript
// src/index.ts
import { Plugin } from '@nexus/core';

export interface MyPluginOptions {
  // Options
}

export const myPlugin = (options?: MyPluginOptions): Plugin => {
  return {
    name: 'my-plugin',
    version: '1.0.0',

    install(app) {
      // Plugin logic
    }
  };
};

export { useMyPlugin } from './composable';
export { MyComponent } from './components';
export type { MyPluginOptions };
```

## Summary

Nexus has a growing ecosystem:

1. **Official Plugins**: Router, Forms, i18n, Query
2. **Community**: UI libraries, animations, charts
3. **Create Plugins**: Simple plugin API
4. **Vite Integration**: First-class Vite support
5. **Publishing**: Easy to share plugins
6. **Quality**: TypeScript-first, tested
7. **Performance**: Tree-shakeable, optimized

Build and share plugins to extend Nexus.
