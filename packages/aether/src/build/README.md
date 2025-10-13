# Aether Build Optimizations

Comprehensive build optimization tools for production-ready Aether applications.

## Features

### 1. Critical CSS Extraction

Extract and inline critical CSS for above-the-fold content to improve First Contentful Paint (FCP) and Largest Contentful Paint (LCP).

```typescript
import { extractCriticalCSS, RouteBasedCriticalCSS } from '@omnitron-dev/aether/build/critical-css';

// Extract critical CSS for a single page
const result = await extractCriticalCSS({
  html: htmlContent,
  css: cssContent,
  inline: true,
  deferNonCritical: true,
  dimensions: { width: 1300, height: 900 },
});

console.log(result.critical); // Critical CSS
console.log(result.html); // HTML with inlined critical CSS
console.log(result.coverage); // Coverage statistics

// Per-route critical CSS
const manager = new RouteBasedCriticalCSS();
await manager.addRoute('/home', { html, css });
await manager.addRoute('/about', { html, css });

const common = manager.getCommonCriticalCSS();
const report = manager.getCoverageReport();
```

**Features:**
- Automatic detection of above-the-fold selectors
- Inline critical CSS in HTML
- Defer non-critical CSS loading
- Per-route critical CSS extraction
- Force include/exclude patterns
- Coverage analysis

### 2. Advanced Tree-Shaking

Dead code elimination with sophisticated side-effect analysis.

```typescript
import { treeShake, ComponentTreeShaker, RouteTreeShaker } from '@omnitron-dev/aether/build/tree-shaking';

// Tree-shake code
const result = treeShake({
  code: sourceCode,
  aggressive: true,
  removeUnusedImports: true,
  removeUnusedExports: true,
});

console.log(result.code); // Optimized code
console.log(result.removed); // Removed imports/exports/functions
console.log(result.sideEffects); // Detected side effects
console.log(result.pureFunctions); // Pure functions

// Component-level tree-shaking
const componentShaker = new ComponentTreeShaker();
componentShaker.addComponent('Button', buttonCode);
componentShaker.markUsed('Button');
const unused = componentShaker.getUnusedComponents();

// Route-based tree-shaking
const routeShaker = new RouteTreeShaker();
routeShaker.addRoute('/home', ['Header', 'HomeContent', 'Footer']);
routeShaker.addRoute('/about', ['Header', 'AboutContent', 'Footer']);

const common = routeShaker.getCommonComponents(); // ['Header', 'Footer']
const strategy = routeShaker.generateSplitStrategy();
```

**Features:**
- Dead code elimination
- Side-effect analysis (console, network, timers, etc.)
- Pure function detection
- Unused import/export removal
- Component-level tree-shaking
- Route-based code splitting

### 3. Build Performance

Worker threads, incremental compilation, and smart caching.

```typescript
import {
  BuildCache,
  IncrementalCompiler,
  HMROptimizer,
  ModuleFederationManager,
  BuildPerformanceMonitor,
} from '@omnitron-dev/aether/build/build-performance';

// Build cache
const cache = new BuildCache('.aether/cache', 'hybrid');
await cache.init();

const hasChanged = await cache.hasChanged('module.js', content);
await cache.set('module.js', cacheEntry);

// Incremental compilation
const compiler = new IncrementalCompiler(cache);
const needsRecompilation = await compiler.needsRecompilation('module.js', content);

compiler.updateDependencies('module.js', ['dep1.js', 'dep2.js']);
const affected = compiler.getAffectedModules('dep1.js');

// HMR optimization
const hmr = new HMROptimizer();
hmr.markBoundary('component.tsx');
hmr.registerAcceptance('app.js', ['component.js']);

const scope = hmr.getUpdateScope('component.js');
const update = hmr.optimizeUpdate(['component.js']);

// Performance monitoring
const monitor = new BuildPerformanceMonitor();
monitor.start();
monitor.mark('parse');
monitor.mark('transform');
monitor.mark('bundle');

const report = monitor.generateReport();
console.log(report.total, report.metrics, report.breakdown);
```

**Features:**
- Memory, disk, and hybrid caching strategies
- Incremental compilation with dependency tracking
- HMR scope optimization
- Worker thread compilation
- Module federation support
- Performance monitoring and reporting

### 4. Asset Pipeline

Image optimization, font subsetting, SVG optimization, and compression.

```typescript
import {
  AssetPipeline,
  ImageOptimizer,
  FontSubsetter,
  SVGOptimizer,
} from '@omnitron-dev/aether/build/asset-pipeline';

// Asset pipeline
const pipeline = new AssetPipeline({
  optimizeImages: true,
  imageFormats: ['webp', 'avif'],
  imageQuality: 80,
  subsetFonts: true,
  optimizeSVG: true,
  fingerprint: true,
  cdnUrl: 'https://cdn.example.com',
  compress: true,
  compressionFormats: ['gzip', 'brotli'],
});

const assets = new Map([
  ['image.jpg', imageBuffer],
  ['font.woff2', fontBuffer],
  ['icon.svg', svgBuffer],
]);

const result = await pipeline.processAssets(assets);
console.log(result.manifest); // Asset manifest
console.log(result.stats); // Optimization statistics

// Image optimization
const imageOptimizer = new ImageOptimizer(80, ['webp', 'avif']);
const optimized = await imageOptimizer.optimize(imageBuffer, 'jpeg');

// Font subsetting
const subsetter = new FontSubsetter();
const glyphs = subsetter.extractGlyphs('Hello World');
const subset = await subsetter.subset(fontBuffer, glyphs);

// SVG optimization
const svgOptimizer = new SVGOptimizer({
  removeComments: true,
  removeMetadata: true,
  removeHiddenElements: true,
  minifyStyles: true,
});
const optimizedSvg = await svgOptimizer.optimize(svgBuffer);
```

**Features:**
- Image optimization (WebP, AVIF conversion)
- Font subsetting and format conversion
- SVG optimization
- Asset fingerprinting
- CDN URL generation
- Compression (gzip, brotli)
- Asset manifest generation

### 5. Bundle Optimization

Chunk splitting, code splitting, and minification strategies.

```typescript
import { BundleOptimizer, CodeSplitter } from '@omnitron-dev/aether/build/bundle-optimization';

// Bundle optimization
const optimizer = new BundleOptimizer({
  vendorChunks: true,
  vendorChunkSize: 500000,
  commonChunks: true,
  minChunkSize: 20000,
  maxChunkSize: 250000,
  concatenateModules: true,
  scopeHoisting: true,
  minifier: 'terser',
  codeSplitting: true,
});

optimizer.addModule('src/main.ts', {
  id: 'src/main.ts',
  code: sourceCode,
  size: 1000,
  dependencies: ['src/utils.ts'],
  dynamicImports: [],
});

const result = await optimizer.optimize();
console.log(result.chunks); // Generated chunks
console.log(result.chunkGraph); // Chunk dependency graph
console.log(result.stats); // Bundle statistics
console.log(result.report); // Optimization report

// Code splitting
const splitter = new CodeSplitter();
splitter.addSplitPoint('lazy-component', {
  moduleId: 'src/components/LazyComponent.tsx',
  chunkName: 'lazy-component',
  strategy: 'lazy', // or 'eager' or 'prefetch'
});

const code = splitter.generateDynamicImport('module.js', 'lazy');
```

**Features:**
- Vendor chunk splitting
- Common chunks extraction
- Dynamic chunk loading
- Module concatenation
- Scope hoisting
- Minification (terser, esbuild, swc)
- Bundle size analysis
- Optimization recommendations

### 6. Vite Plugin Integration

All-in-one Vite plugin integrating all optimization features.

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import { aetherBuildPlugin } from '@omnitron-dev/aether/build/vite-plugin';

export default defineConfig({
  plugins: [
    aetherBuildPlugin({
      // Critical CSS
      criticalCSS: true,
      criticalCSSOptions: {
        inline: true,
        perRoute: true,
        dimensions: { width: 1300, height: 900 },
      },

      // Tree-shaking
      treeShaking: true,
      treeShakingOptions: {
        aggressive: true,
        removeUnusedImports: true,
        removeUnusedExports: true,
      },

      // Performance
      performance: true,
      performanceOptions: {
        workers: 4,
        incremental: true,
        cacheStrategy: 'hybrid',
        moduleFederation: false,
      },

      // Assets
      assets: true,
      assetOptions: {
        optimizeImages: true,
        imageFormats: ['webp', 'avif'],
        subsetFonts: true,
        optimizeSVG: true,
        cdnUrl: 'https://cdn.example.com',
      },

      // Bundle optimization
      bundleOptimization: true,
      bundleOptions: {
        vendorChunks: true,
        commonChunks: true,
        maxChunkSize: 250000,
        minifier: 'terser',
      },

      // Reporting
      generateReport: true,
      reportPath: 'dist/aether-build-report.json',
    }),
  ],
});
```

**Plugin Features:**
- Automatic integration of all optimizations
- Transform hook for tree-shaking
- Generate bundle hook for asset optimization
- HMR optimization
- Build performance monitoring
- Comprehensive build report
- Console summary output

## Build Report

When `generateReport: true`, a JSON report is generated:

```json
{
  "timestamp": "2025-10-13T12:00:00.000Z",
  "duration": 5432,
  "criticalCSS": {
    "routes": 5,
    "averageCoverage": 67.5
  },
  "treeShaking": {
    "originalSize": 1500000,
    "optimizedSize": 1200000,
    "savings": 300000
  },
  "assets": {
    "totalAssets": 42,
    "savings": 850000,
    "savingsPercent": 45.2
  },
  "bundles": {
    "totalChunks": 8,
    "totalSize": 450000,
    "gzippedSize": 135000
  },
  "performance": {
    "cacheHitRate": 78.3,
    "workersUsed": 4
  }
}
```

## Console Output

The plugin prints a detailed summary:

```
🎨 Aether Build Optimization Summary

⏱️  Duration: 5.43s

📋 Critical CSS:
   Routes: 5
   Avg Coverage: 67.5%

🌳 Tree-Shaking:
   Original: 1465.0KB
   Optimized: 1171.9KB
   Savings: 293.1KB

🖼️  Assets:
   Total: 42
   Savings: 45.2%

📦 Bundles:
   Chunks: 8
   Total: 439.5KB
   Gzipped: 131.8KB

⚡ Performance:
   Cache Hit Rate: 78.3%
   Workers: 4
```

## Best Practices

1. **Critical CSS**: Enable per-route extraction for optimal FCP/LCP
2. **Tree-Shaking**: Use aggressive mode in production builds
3. **Performance**: Use hybrid caching for best balance
4. **Assets**: Enable all optimization formats (WebP, AVIF, Brotli)
5. **Bundles**: Keep max chunk size around 250KB for optimal loading

## Performance Impact

Expected improvements:
- **Bundle Size**: 30-50% reduction
- **FCP**: 20-40% improvement
- **LCP**: 15-30% improvement
- **Build Time**: 10-20% faster with caching

## TypeScript Support

All APIs are fully typed with comprehensive interfaces and type definitions.

## License

MIT
