# Aether Compiler

The Aether compiler transforms TypeScript/JSX source code into optimized JavaScript with fine-grained reactivity optimizations.

## Architecture

The compiler consists of several core modules:

### Core Modules

- **`types.ts`** - Type definitions and interfaces for the entire compiler
- **`parser.ts`** - TypeScript/JSX parser using TypeScript Compiler API
- **`analyzer.ts`** - Static analysis for optimization opportunities
- **`transformer.ts`** - AST transformation pipeline with optimization passes
- **`codegen.ts`** - Code generation from transformed AST
- **`index.ts`** - Main compiler API

### Additional Modules

- **`compiler.ts`** - High-level compiler class with metrics
- **`optimizer.ts`** - Orchestrates optimization passes
- **`optimizations/`** - Individual optimization pass implementations

## Usage

### Basic Compilation

```typescript
import { compile } from '@omnitron-dev/aether/compiler';

const result = compile(sourceCode, 'component.tsx', {
  optimize: 'aggressive',
  jsx: { runtime: 'automatic' },
  sourcemap: true
});

console.log(result.code);
console.log(result.warnings);
```

### Using the Compiler Class

```typescript
import { AetherCompiler } from '@omnitron-dev/aether/compiler';

const compiler = new AetherCompiler({
  mode: 'production',
  optimize: 'aggressive',
  islands: true,
  serverComponents: true
});

const result = await compiler.compile(sourceCode, 'component.tsx');
console.log(result.metrics); // Performance metrics
```

### Analysis Only

```typescript
import { analyzeOnly } from '@omnitron-dev/aether/compiler';

const analysis = analyzeOnly(sourceCode, 'component.tsx');
console.log(analysis.signals); // Detected signals
console.log(analysis.effects); // Detected effects
console.log(analysis.optimizations); // Optimization opportunities
```

### Custom Transform Pass

```typescript
import { createTransformPass, transform } from '@omnitron-dev/aether/compiler';

const myPass = createTransformPass('my-optimization', (sourceFile, analysis, options) => {
  // Custom transformation logic
  return sourceFile;
});

// Apply custom pass
const transformed = transform(sourceFile, analysis, {
  optimize: 'basic',
  // Custom passes can be added via plugins
});
```

### Compiler Plugin

```typescript
import { compile, createPlugin } from '@omnitron-dev/aether/compiler';

const customPlugin = createPlugin({
  name: 'my-plugin',
  enforce: 'pre',
  transform(code, id) {
    if (id.endsWith('.custom')) {
      return {
        code: transformCustomSyntax(code),
        warnings: []
      };
    }
  }
});

const result = compile(code, 'file.tsx', {
  plugins: [customPlugin]
});
```

## Compiler Options

```typescript
interface CompilerOptions {
  /** Target environment */
  target?: 'es2015' | 'es2020' | 'esnext';

  /** JSX configuration */
  jsx?: {
    runtime?: 'automatic' | 'classic';
    pragma?: string;
    pragmaFrag?: string;
    importSource?: string;
  };

  /** Optimization level */
  optimize?: 'none' | 'basic' | 'aggressive';

  /** Source map configuration */
  sourcemap?: boolean | 'inline' | 'hidden';

  /** Minification */
  minify?: boolean | MinifyConfig;

  /** Compilation mode */
  mode?: 'development' | 'production';

  /** Enable islands optimization */
  islands?: boolean;

  /** Enable server components */
  serverComponents?: boolean;

  /** Compiler plugins */
  plugins?: CompilerPlugin[];
}
```

## Optimization Passes

The transformer applies various optimization passes based on the `optimize` setting:

### Basic Optimizations

1. **JSX Transform** - Converts JSX to optimized DOM operations
2. **Hoist Static Elements** - Moves static JSX outside component functions
3. **Optimize Signals** - Converts never-updated signals to constants

### Aggressive Optimizations

In addition to basic optimizations:

4. **Inline Components** - Inlines small components for better performance
5. **Batch Effects** - Groups multiple effects together
6. **Eliminate Dead Code** - Removes unreachable code
7. **Constant Folding** - Evaluates constant expressions at compile time

## Analysis Results

The analyzer detects:

- **Signals** - Signal declarations and usage patterns
- **Effects** - Effect declarations and dependencies
- **Computed Values** - Computed/memo declarations
- **Components** - Component definitions and characteristics
- **Static Elements** - JSX elements that can be hoisted
- **Optimization Opportunities** - Potential optimizations

## Code Generation

The code generator supports:

- **Pretty printing** for development
- **Minification** for production
- **Source maps** (inline, external, or hidden)
- **Target environments** (ES2015, ES2020, ESNext)
- **Declaration files** (.d.ts generation)

## Integration with Vite

The compiler integrates with Vite via the plugin:

```typescript
import { defineConfig } from 'vite';
import aether from '@omnitron-dev/aether/build/vite-plugin';

export default defineConfig({
  plugins: [
    aether({
      compiler: {
        optimize: 'aggressive',
        islands: true
      }
    })
  ]
});
```

## Performance

The compiler is designed for speed:

- **Incremental compilation** - Only recompiles changed files
- **Parallel processing** - Analyzes multiple files concurrently
- **Caching** - Caches analysis results for faster rebuilds
- **Metrics collection** - Tracks compilation time and size reduction

## Type Safety

The compiler preserves TypeScript types throughout the pipeline:

- **Type-preserving transformations** - Types are maintained after transformation
- **Type checker integration** - Optional semantic analysis with TypeScript's type checker
- **Declaration generation** - Generates accurate .d.ts files

## Example: Full Pipeline

```typescript
import {
  parse,
  analyze,
  transform,
  generate
} from '@omnitron-dev/aether/compiler';

// 1. Parse
const parseResult = parse(sourceCode, 'component.tsx', {
  jsx: { runtime: 'automatic' }
});

// 2. Analyze
const analysis = analyze(parseResult.sourceFile, {
  optimize: 'aggressive'
});

// 3. Transform
const transformedAST = transform(parseResult.sourceFile, analysis, {
  optimize: 'aggressive'
});

// 4. Generate
const output = generate(transformedAST, {
  pretty: false,
  sourceMaps: true
});

console.log(output.code);
console.log(output.map);
```

## Debugging

Enable detailed warnings:

```typescript
const result = compile(code, 'file.tsx', {
  mode: 'development',
  sourcemap: 'inline'
});

// Check warnings
for (const warning of result.warnings) {
  console.log(warning.message);
  console.log(warning.location);
}
```

## Best Practices

1. **Use `aggressive` optimization in production** for maximum performance
2. **Enable source maps in development** for better debugging
3. **Run analysis separately** for IDE integrations and tooling
4. **Create custom plugins** for project-specific transformations
5. **Cache compilation results** for faster rebuilds

## API Reference

See the full API documentation in the source files:

- [types.ts](./types.ts) - All type definitions
- [index.ts](./index.ts) - Main API functions
- [compiler.ts](./compiler.ts) - AetherCompiler class
- [parser.ts](./parser.ts) - Parser utilities
- [analyzer.ts](./analyzer.ts) - Analysis utilities
- [transformer.ts](./transformer.ts) - Transform utilities
- [codegen.ts](./codegen.ts) - Code generation utilities
