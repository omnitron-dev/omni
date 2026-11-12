import { defineConfig } from 'tsup';
import manifest from './package.json';

// Bundle only the syntax tokenizer, excluding its unused legacy HTML renderer.
// The AST itself is ordinary ESM emitted once by TypeScript.
export default defineConfig({
  ...manifest.tsup,
  entry: { 'compiler/math-syntax': 'src/compiler/math-syntax.ts' },
  format: ['esm'],
  splitting: false,
  dts: false,
  sourcemap: true,
  clean: false,
  treeshake: true,
});
