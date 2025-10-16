/**
 * MDX Compiler
 *
 * Main compiler that orchestrates parsing, transformation, and generation
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';

import { AetherMDXParser, createParser } from './parser.js';
import { MDXToVNodeTransformer, TransformPipeline, ReactiveContentTransform } from './transformer.js';
import { AetherComponentGenerator, generateComponent, createMDXModule } from './generator.js';
import { defineComponent } from '../../core/component/define.js';
import { jsx } from '../../jsx-runtime.js';

import type { CompileMDXOptions, MDXModule, MDXComponent } from '../types.js';

/**
 * MDX Compiler class
 */
export class MDXCompiler {
  private parser: AetherMDXParser;
  private transformer: MDXToVNodeTransformer;
  private generator: AetherComponentGenerator;
  private options: CompileMDXOptions;

  constructor(options: CompileMDXOptions = {}) {
    this.options = {
      mode: 'production',
      outputFormat: 'component',
      jsx: true,
      gfm: true,
      frontmatter: true,
      ...options,
    };

    // Initialize components
    this.parser = createParser(this.options);

    // Create transform pipeline
    const pipeline = new TransformPipeline();

    // Add built-in transforms
    pipeline.useAether(new ReactiveContentTransform());

    // Add user plugins
    if (this.options.aetherPlugins) {
      for (const plugin of this.options.aetherPlugins) {
        pipeline.useAether(plugin);
      }
    }

    this.transformer = pipeline.createTransformer({
      scope: this.options.scope,
      components: this.options.components,
    });

    this.generator = new AetherComponentGenerator({
      mode: this.options.mode as any,
      target: this.options.target,
      optimize: this.options.optimize as any,
    });
  }

  /**
   * Compile MDX source to module
   */
  async compile(source: string): Promise<MDXModule> {
    try {
      // Parse MDX to AST
      const ast = await this.parser.parseAsync(source);

      // Extract metadata
      const frontmatter = this.parser.extractFrontmatter(ast);
      const toc = this.parser.extractTOC(ast);

      // Apply remark plugins if needed
      let processedAst = ast;
      if (this.options.remarkPlugins) {
        const processor = unified().use(remarkParse).use(remarkMdx);

        for (const plugin of this.options.remarkPlugins) {
          if (Array.isArray(plugin)) {
            processor.use(plugin[0], plugin[1]);
          } else {
            processor.use(plugin);
          }
        }

        const result = await processor.run(ast);
        // Ensure the result has children property for Root type compatibility
        processedAst = result as typeof ast;
      }

      // Transform to MDX nodes
      const mdxNode = this.parser.transformToMDXNode(processedAst);

      // Transform to VNodes
      const vnodes = await this.transformer.transform(mdxNode);
      if (!vnodes) {
        throw new Error('Failed to transform MDX to VNodes');
      }

      // Get metadata
      const metadata = this.transformer.getMetadata();

      // Generate component code
      const code = await generateComponent([vnodes], this.options, {
        hasReactiveContent: metadata.hasReactiveContent,
        usedComponents: metadata.usedComponents,
        frontmatter,
        scope: this.options.scope,
      });

      // Create module with VNode tree for actual rendering
      return createMDXModule(code, [vnodes], {
        frontmatter,
        toc,
        usedComponents: metadata.usedComponents,
      });
    } catch (error) {
      console.error('MDX compilation failed:', error);
      throw error;
    }
  }

  /**
   * Compile MDX synchronously
   */
  compileSync(source: string): MDXModule {
    try {
      // Parse MDX to AST
      const ast = this.parser.parse(source);

      // Extract metadata
      const frontmatter = this.parser.extractFrontmatter(ast);
      const toc = this.parser.extractTOC(ast);

      // Transform to MDX nodes
      const mdxNode = this.parser.transformToMDXNode(ast);

      // Note: Sync compilation doesn't support async plugins
      // Transform to VNodes synchronously
      const vnodes = this.transformSyncUnsafe(mdxNode);

      // Get metadata
      const metadata = this.transformer.getMetadata();

      // Generate component code
      const code = this.generator.generate([vnodes], {
        hasReactiveContent: metadata.hasReactiveContent,
        usedComponents: metadata.usedComponents,
        frontmatter,
        scope: this.options.scope,
      });

      // Create module with VNode tree for actual rendering
      return createMDXModule(code, [vnodes], {
        frontmatter,
        toc,
        usedComponents: metadata.usedComponents,
      });
    } catch (error) {
      console.error('MDX sync compilation failed:', error);
      throw error;
    }
  }

  /**
   * Unsafe synchronous transform (skips async plugins)
   */
  private transformSyncUnsafe(mdxNode: any): any {
    // This is a simplified sync version that skips async plugin transforms
    return this.transformer.transformSync(mdxNode);
  }
}

/**
 * Compile MDX source to module
 */
export async function compileMDX(source: string, options?: CompileMDXOptions): Promise<MDXModule> {
  const compiler = new MDXCompiler(options);
  return compiler.compile(source);
}

/**
 * Compile MDX synchronously
 */
export function compileMDXSync(source: string, options?: CompileMDXOptions): MDXModule {
  const compiler = new MDXCompiler(options);
  return compiler.compileSync(source);
}

/**
 * Evaluate compiled MDX code
 * In production, this would use a proper module system
 */
export function evaluateMDX(compiledCode: string, scope?: Record<string, any>): MDXComponent {
  // This is a placeholder - in production we'd use a proper evaluation method
  // For now, return a dummy component
  void compiledCode; // Mark as intentionally unused
  void scope; // Mark as intentionally unused

  return defineComponent(() => () => jsx('div', {}, 'Evaluated MDX')) as MDXComponent;
}

/**
 * Render MDX component
 */
export function renderMDX(component: MDXComponent, props?: Record<string, any>): any {
  return component(props || {});
}

// Export compiler components for advanced usage
export { AetherMDXParser, MDXToVNodeTransformer, AetherComponentGenerator };
export { TransformPipeline, ReactiveContentTransform };

// Re-export types
export type { CompileMDXOptions, MDXModule, MDXComponent, AetherMDXPlugin, TOCEntry } from '../types.js';
