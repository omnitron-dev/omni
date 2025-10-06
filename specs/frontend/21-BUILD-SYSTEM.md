# 21. Build System

## Table of Contents

- [Overview](#overview)
- [Philosophy](#philosophy)
- [Build Commands](#build-commands)
- [Configuration](#configuration)
- [Development Server](#development-server)
- [Production Build](#production-build)
- [Code Splitting](#code-splitting)
- [Asset Handling](#asset-handling)
- [Optimization](#optimization)
- [Plugins](#plugins)
- [Environment Variables](#environment-variables)
- [TypeScript](#typescript)
- [CSS Processing](#css-processing)
- [Performance](#performance)
- [Best Practices](#best-practices)
- [Advanced Patterns](#advanced-patterns)
- [API Reference](#api-reference)
- [Examples](#examples)

## Overview

Aether build system is powered by **Vite** with custom optimizations for:

- ⚡ **Lightning-fast dev server** with HMR
- 📦 **Optimized production builds** with Rollup
- 🔄 **Zero-config** setup out of the box
- 🎯 **Smart code splitting** by route and component
- 🖼️ **Asset optimization** for images, fonts, SVGs
- 🔧 **Extensible** via plugins
- 📊 **Build analytics** and visualization

### Build Pipeline

```
Development:
Source → Vite Dev Server → HMR → Browser
         ↑
         └─ ESBuild (TypeScript, JSX)

Production:
Source → Compiler → Rollup → Terser → Output
         ↑          ↑        ↑
         │          │        └─ Minification
         │          └─ Bundling & Code Splitting
         └─ Transform & Optimize
```

### Quick Start

```bash
# Development
npm run dev

# Production build
npm run build

# Preview production build
npm run preview

# Analyze bundle
npm run build -- --analyze
```

## Philosophy

### Zero Configuration

**Works out of the box**:

```typescript
// No config needed!
// Just create routes/ and start building

// routes/index.tsx
export default defineComponent(() => {
  return () => <h1>Hello World</h1>;
});

// npm run dev → Works!
```

### Convention Over Configuration

**Smart defaults based on file structure**:

```
src/
├── routes/           → Automatic routing
├── components/       → Component auto-import
├── assets/          → Asset processing
├── styles/          → Global styles
└── public/          → Static files
```

### Progressive Enhancement

**Start simple, add complexity when needed**:

```typescript
// 1. Start with zero config
// Works: npm run dev

// 2. Add custom config when needed
// nexus.config.ts
export default {
  build: {
    sourcemap: true
  }
};

// 3. Add plugins for advanced features
import { imageOptimization } from 'nexus/plugins';

export default {
  plugins: [imageOptimization()]
};
```

### Performance First

**Optimizations by default**:

- ✅ Tree-shaking enabled
- ✅ Code splitting by route
- ✅ Asset optimization
- ✅ CSS minification
- ✅ Compression (gzip/brotli)

## Build Commands

### Development

Start dev server:

```bash
# Default (port 3000)
npm run dev

# Custom port
npm run dev -- --port 5000

# Custom host
npm run dev -- --host 0.0.0.0

# HTTPS
npm run dev -- --https

# Open browser
npm run dev -- --open
```

### Production Build

Build for production:

```bash
# Standard build
npm run build

# Build with sourcemaps
npm run build -- --sourcemap

# Build specific target
npm run build -- --target es2020

# SSR build
npm run build -- --ssr

# SSG build
npm run build -- --ssg
```

### Preview

Preview production build:

```bash
# Preview
npm run preview

# Custom port
npm run preview -- --port 8080
```

### Analyze

Analyze bundle:

```bash
# Bundle analysis
npm run build -- --analyze

# Opens interactive visualization
```

### Clean

Clean build artifacts:

```bash
# Clean dist/
npm run clean

# Clean everything (node_modules, dist/, cache)
npm run clean:all
```

## Configuration

### Basic Configuration

```typescript
// nexus.config.ts
import { defineConfig } from 'aether';

export default defineConfig({
  // App config
  app: {
    name: 'My App',
    version: '1.0.0'
  },

  // Build config
  build: {
    outDir: 'dist',
    sourcemap: true,
    minify: true,
    target: 'es2020'
  },

  // Server config
  server: {
    port: 3000,
    host: '0.0.0.0',
    https: false
  }
});
```

### Path Aliases

Configure path aliases:

```typescript
export default defineConfig({
  alias: {
    '@': './src',
    '@components': './src/components',
    '@utils': './src/utils',
    '@styles': './src/styles'
  }
});

// Usage
import { Button } from '@components/Button';
import { formatDate } from '@utils/date';
```

### Base Path

Set base path for deployment:

```typescript
export default defineConfig({
  base: '/my-app/', // Deploy to /my-app/

  // Or use environment variable
  base: process.env.BASE_URL || '/'
});
```

### Public Directory

Configure public directory:

```typescript
export default defineConfig({
  publicDir: 'public',

  // Or disable
  publicDir: false
});
```

## Development Server

### Hot Module Replacement (HMR)

Automatic HMR:

```typescript
// Component updates without full reload
export default defineComponent(() => {
  const count = signal(0);

  return () => (
    <button onClick={() => count.set(count() + 1)}>
      {count()}
    </button>
  );
});

// Edit component → HMR update → State preserved
```

### Fast Refresh

Fast Refresh for components:

```typescript
// Changes to this component trigger Fast Refresh
export const Button = defineComponent(() => {
  // ... component code
});

// State is preserved across updates
```

### Dev Server Options

```typescript
export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
    open: true, // Open browser
    https: {
      key: './key.pem',
      cert: './cert.pem'
    },
    cors: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true
      }
    }
  }
});
```

### Middleware

Add dev server middleware:

```typescript
export default defineConfig({
  server: {
    middlewares: [
      (req, res, next) => {
        // Custom middleware
        console.log(req.method, req.url);
        next();
      }
    ]
  }
});
```

## Production Build

### Build Output

Standard build output:

```
dist/
├── index.html
├── assets/
│   ├── index.[hash].js      # Main bundle
│   ├── index.[hash].css     # Main styles
│   ├── vendor.[hash].js     # Vendor bundle
│   └── chunks/
│       ├── about.[hash].js  # Route chunks
│       └── user.[hash].js
└── images/
    └── logo.[hash].png      # Optimized images
```

### Build Targets

Configure build target:

```typescript
export default defineConfig({
  build: {
    // ES2020 (modern browsers)
    target: 'es2020',

    // ES2015 (legacy browsers)
    target: 'es2015',

    // Multiple targets
    target: ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14']
  }
});
```

### Build Modes

Different build modes:

```bash
# Development build (sourcemaps, no minification)
npm run build -- --mode development

# Production build (minified, optimized)
npm run build -- --mode production

# Custom mode
npm run build -- --mode staging
```

### Source Maps

Configure source maps:

```typescript
export default defineConfig({
  build: {
    // Inline source maps
    sourcemap: 'inline',

    // External source maps
    sourcemap: true,

    // Hidden source maps
    sourcemap: 'hidden',

    // No source maps
    sourcemap: false
  }
});
```

## Code Splitting

### Route-Based Splitting

Automatic route-based splitting:

```
routes/
├── index.tsx           → index.[hash].js
├── about.tsx           → about.[hash].js
└── users/
    └── [id].tsx        → users-[id].[hash].js

// Each route is a separate chunk
// Loaded on-demand
```

### Component-Based Splitting

Split by component:

```typescript
// Lazy load component
const HeavyComponent = lazy(() => import('./HeavyComponent'));

export default defineComponent(() => {
  const show = signal(false);

  return () => (
    <div>
      <button onClick={() => show.set(true)}>Load</button>

      {#if show()}
        <Suspense fallback={<Spinner />}>
          <HeavyComponent />
        </Suspense>
      {/if}
    </div>
  );
});

// HeavyComponent is in separate chunk
// Only loaded when needed
```

### Manual Chunks

Configure manual chunks:

```typescript
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunk
          vendor: ['react', 'react-dom'],

          // UI library chunk
          ui: ['@ui/components', '@ui/primitives'],

          // Utils chunk
          utils: ['lodash', 'date-fns']
        }
      }
    }
  }
});
```

### Dynamic Imports

Dynamic imports:

```typescript
// Dynamic import
const loadChart = async () => {
  const { Chart } = await import('./Chart');
  return Chart;
};

// With prefetch
const loadChart = () => import(/* webpackPrefetch: true */ './Chart');

// With preload
const loadChart = () => import(/* webpackPreload: true */ './Chart');
```

## Asset Handling

### Images

Image handling:

```typescript
// Import as URL
import logoUrl from './logo.png';

<img src={logoUrl} alt="Logo" />

// Import as raw (base64)
import logoBase64 from './logo.png?raw';

<img src={logoBase64} alt="Logo" />

// Optimized image component
import { Image } from 'nexus/image';

<Image
  src="./hero.jpg"
  alt="Hero"
  width={1200}
  height={600}
  formats={['webp', 'avif']}
/>

// Build output:
// - hero-640w.webp
// - hero-1024w.webp
// - hero-1920w.webp
// - hero-640w.avif
// - hero-1024w.avif
// - hero-1920w.avif
```

### SVG

SVG handling:

```typescript
// As component
import Logo from './logo.svg?component';

<Logo className="logo" />

// As URL
import logoUrl from './logo.svg?url';

<img src={logoUrl} alt="Logo" />

// Inline
import logoInline from './logo.svg?inline';

<div innerHTML={logoInline} />
```

### Fonts

Font handling:

```css
/* Import font */
@font-face {
  font-family: 'Inter';
  src: url('./fonts/Inter.woff2') format('woff2');
  font-display: swap;
}

/* Build:
   - Fonts hashed: Inter.[hash].woff2
   - Preloaded automatically
   - Subsetting applied
*/
```

### JSON

JSON imports:

```typescript
// Import entire JSON
import data from './data.json';

console.log(data);

// Named imports
import { users } from './data.json';

console.log(users);
```

### CSS

CSS imports:

```typescript
// Import CSS (side effect)
import './styles.css';

// CSS modules
import styles from './Button.module.css';

<button class={styles.button}>Click</button>

// Scoped CSS
<style>{`
  button {
    background: blue;
  }
`}</style>
```

## Optimization

### Minification

Minify output:

```typescript
export default defineConfig({
  build: {
    minify: 'terser',

    terserOptions: {
      compress: {
        drop_console: true, // Remove console.log
        drop_debugger: true, // Remove debugger
        pure_funcs: ['console.log', 'console.info'] // Remove specific functions
      }
    }
  }
});
```

### Tree Shaking

Automatic tree-shaking:

```typescript
// utils.ts
export function used() { /* ... */ }
export function unused() { /* ... */ }

// app.ts
import { used } from './utils';

used();

// Build output: Only 'used' is included
// 'unused' is tree-shaken away
```

### Compression

Enable compression:

```typescript
import compression from 'vite-plugin-compression';

export default defineConfig({
  plugins: [
    compression({
      algorithm: 'gzip',
      threshold: 1024 // Only compress files > 1KB
    }),

    compression({
      algorithm: 'brotliCompress',
      ext: '.br'
    })
  ]
});

// Build output:
// - app.[hash].js (original)
// - app.[hash].js.gz (gzip)
// - app.[hash].js.br (brotli)
```

### Preloading

Configure preloading:

```typescript
export default defineConfig({
  build: {
    modulePreload: {
      polyfill: true, // Polyfill for old browsers
      resolveDependencies: (url, deps, context) => {
        // Custom logic to determine what to preload
        return deps.filter(dep => !dep.includes('vendor'));
      }
    }
  }
});
```

### Critical CSS

Extract critical CSS:

```typescript
import criticalCss from 'vite-plugin-critical-css';

export default defineConfig({
  plugins: [
    criticalCss({
      inline: true,
      minify: true,
      extract: true,
      dimensions: [
        { width: 375, height: 667 }, // Mobile
        { width: 1920, height: 1080 } // Desktop
      ]
    })
  ]
});

// Build output:
// - Critical CSS inlined in <head>
// - Non-critical CSS loaded async
```

## Plugins

### Official Plugins

```typescript
import {
  imageOptimization,
  pwa,
  sitemap,
  compression
} from 'nexus/plugins';

export default defineConfig({
  plugins: [
    // Image optimization
    imageOptimization({
      formats: ['webp', 'avif'],
      quality: 80
    }),

    // PWA
    pwa({
      manifest: {
        name: 'My App',
        short_name: 'App',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          }
        ]
      }
    }),

    // Sitemap
    sitemap({
      hostname: 'https://example.com'
    }),

    // Compression
    compression()
  ]
});
```

### Custom Plugins

Create custom plugin:

```typescript
// plugins/my-plugin.ts
import { Plugin } from 'vite';

export function myPlugin(): Plugin {
  return {
    name: 'my-plugin',

    // Transform hook
    transform(code, id) {
      if (id.endsWith('.custom')) {
        return {
          code: transformCode(code),
          map: null
        };
      }
    },

    // Load hook
    load(id) {
      if (id.endsWith('.virtual')) {
        return 'export default "virtual content"';
      }
    },

    // Build start
    buildStart() {
      console.log('Build started');
    },

    // Build end
    buildEnd() {
      console.log('Build ended');
    }
  };
}

// nexus.config.ts
import { myPlugin } from './plugins/my-plugin';

export default defineConfig({
  plugins: [myPlugin()]
});
```

## Environment Variables

### Env Files

```bash
# .env (all environments)
VITE_API_URL=https://api.example.com

# .env.local (local only, gitignored)
VITE_SECRET_KEY=secret

# .env.development (development only)
VITE_API_URL=http://localhost:4000

# .env.production (production only)
VITE_API_URL=https://api.production.com
```

### Access in Code

```typescript
// Client-side (prefixed with VITE_)
const apiUrl = import.meta.env.VITE_API_URL;
const isDev = import.meta.env.DEV;
const isProd = import.meta.env.PROD;
const mode = import.meta.env.MODE;

// Type-safe env
declare global {
  interface ImportMetaEnv {
    VITE_API_URL: string;
    VITE_SECRET_KEY?: string;
  }
}
```

### Server-Side Variables

```typescript
// Server-side (all variables available)
export const loader = async () => {
  const secret = process.env.SECRET_KEY;
  const dbUrl = process.env.DATABASE_URL;

  // ...
};
```

### Build-Time Replacement

Replace at build time:

```typescript
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString())
  }
});

// Usage
console.log(__APP_VERSION__); // "1.0.0"
console.log(__BUILD_TIME__); // "2024-01-01T00:00:00.000Z"
```

## TypeScript

### TypeScript Config

Recommended TypeScript config:

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "strict": true,
    "noEmit": true,
    "jsx": "preserve",
    "jsxImportSource": "nexus",
    "types": ["vite/client", "nexus"],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

### Type Checking

Type check during build:

```typescript
import checker from 'vite-plugin-checker';

export default defineConfig({
  plugins: [
    checker({
      typescript: true,
      eslint: {
        lintCommand: 'eslint "./src/**/*.{ts,tsx}"'
      }
    })
  ]
});
```

## CSS Processing

### PostCSS

Configure PostCSS:

```javascript
// postcss.config.js
export default {
  plugins: {
    'postcss-import': {},
    'tailwindcss': {},
    'autoprefixer': {},
    'cssnano': {
      preset: 'default'
    }
  }
};
```

### CSS Modules

Configure CSS Modules:

```typescript
export default defineConfig({
  css: {
    modules: {
      localsConvention: 'camelCase',
      generateScopedName: '[name]__[local]___[hash:base64:5]'
    }
  }
});
```

### Preprocessors

Use preprocessors:

```bash
# Install preprocessor
npm install -D sass

# Use in code
import './styles.scss';
```

## Performance

### Build Performance

Optimize build performance:

```typescript
export default defineConfig({
  build: {
    // Use ESBuild for minification (faster than Terser)
    minify: 'esbuild',

    // Disable source maps in production
    sourcemap: false,

    // Increase chunk size warning limit
    chunkSizeWarningLimit: 1000,

    // Rollup options
    rollupOptions: {
      // Treeshake unused code
      treeshake: {
        moduleSideEffects: false,
        propertyReadSideEffects: false,
        tryCatchDeoptimization: false
      }
    }
  },

  // Optimize dependencies
  optimizeDeps: {
    include: ['react', 'react-dom'],
    exclude: ['@vendored/lib']
  }
});
```

### Bundle Analysis

Analyze bundle:

```bash
npm run build -- --analyze
```

Output:

```
Bundle Analysis
───────────────────────────────────────
 Chunk       Size      Gzip    Modules
───────────────────────────────────────
 index       245 KB    78 KB   152
 vendor      156 KB    52 KB   48
 about       12 KB     4 KB    8
 user        18 KB     6 KB    12
───────────────────────────────────────
 Total       431 KB    140 KB  220
───────────────────────────────────────

Largest modules:
  1. react-dom         (98 KB)
  2. @ui/components    (45 KB)
  3. chart.js          (38 KB)
```

## Best Practices

### 1. Use Path Aliases

```typescript
// ✅ Clean imports
import { Button } from '@/components/Button';
import { formatDate } from '@/utils/date';

// ❌ Relative imports
import { Button } from '../../../components/Button';
import { formatDate } from '../../utils/date';
```

### 2. Optimize Bundle Size

```typescript
// ✅ Tree-shakeable imports
import { map, filter } from 'lodash-es';

// ❌ Import entire library
import _ from 'lodash';
```

### 3. Use Code Splitting

```typescript
// ✅ Lazy load heavy components
const Chart = lazy(() => import('./Chart'));

// ❌ Import everything upfront
import Chart from './Chart';
```

### 4. Optimize Images

```typescript
// ✅ Use Image component
<Image src="/hero.jpg" width={1200} height={600} />

// ❌ Use raw img tag
<img src="/hero.jpg" />
```

## Advanced Patterns

### Multi-Page App

Build multi-page app:

```typescript
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        admin: 'admin.html',
        mobile: 'mobile.html'
      }
    }
  }
});

// Build output:
// dist/
// ├── index.html
// ├── admin.html
// ├── mobile.html
// └── assets/
```

### Library Mode

Build as library:

```typescript
export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'MyLib',
      fileName: (format) => `my-lib.${format}.js`
    },
    rollupOptions: {
      external: ['react', 'react-dom'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM'
        }
      }
    }
  }
});
```

### Custom Build Script

Custom build script:

```typescript
// scripts/build.ts
import { build } from 'vite';

async function customBuild() {
  // Client build
  await build({
    build: {
      outDir: 'dist/client',
      ssrManifest: true
    }
  });

  // Server build
  await build({
    build: {
      outDir: 'dist/server',
      ssr: 'src/entry-server.ts'
    }
  });

  console.log('Build complete!');
}

customBuild();
```

## API Reference

### defineConfig

```typescript
function defineConfig(config: UserConfig): UserConfig;

interface UserConfig {
  app?: {
    name?: string;
    version?: string;
  };
  build?: {
    outDir?: string;
    sourcemap?: boolean | 'inline' | 'hidden';
    minify?: boolean | 'terser' | 'esbuild';
    target?: string | string[];
  };
  server?: {
    port?: number;
    host?: string;
    https?: boolean | { key: string; cert: string };
  };
  plugins?: Plugin[];
  alias?: Record<string, string>;
}
```

### Plugin API

```typescript
interface Plugin {
  name: string;
  enforce?: 'pre' | 'post';
  apply?: 'serve' | 'build' | ((config: UserConfig) => boolean);

  config?: (config: UserConfig) => UserConfig | void;
  configResolved?: (config: ResolvedConfig) => void;
  configureServer?: (server: ViteDevServer) => void;

  transform?: (code: string, id: string) => string | { code: string; map?: any };
  load?: (id: string) => string | void;
  resolveId?: (id: string) => string | void;

  buildStart?: () => void;
  buildEnd?: () => void;
}
```

## Examples

### Full Configuration

```typescript
// nexus.config.ts
import { defineConfig } from 'aether';
import { imageOptimization, pwa, compression } from 'nexus/plugins';

export default defineConfig({
  // App metadata
  app: {
    name: 'My App',
    version: '1.0.0'
  },

  // Path aliases
  alias: {
    '@': './src',
    '@components': './src/components',
    '@utils': './src/utils'
  },

  // Build config
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV === 'development',
    minify: 'esbuild',
    target: 'es2020',

    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          ui: ['@ui/components']
        }
      }
    }
  },

  // Dev server
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://localhost:4000'
    }
  },

  // Plugins
  plugins: [
    imageOptimization({
      formats: ['webp', 'avif'],
      quality: 80
    }),

    pwa({
      manifest: {
        name: 'My App',
        short_name: 'App'
      }
    }),

    compression()
  ],

  // CSS
  css: {
    modules: {
      localsConvention: 'camelCase'
    }
  },

  // Define constants
  define: {
    __APP_VERSION__: JSON.stringify('1.0.0')
  }
});
```

---

**Aether build system provides a fast, zero-config experience** with powerful optimizations for production. Built on Vite and Rollup, it delivers lightning-fast dev server and optimized production builds.

**Next**: [22. Compiler and Optimizations →](./22-COMPILER.md)
