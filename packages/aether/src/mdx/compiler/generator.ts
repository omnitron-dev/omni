/**
 * MDX Component Generator
 *
 * Generates Aether components from transformed MDX AST
 */

import type { VNode } from '../../reconciler/vnode.js';
import type { CompileMDXOptions, MDXModule } from '../types.js';
import { createElementVNode } from '../../reconciler/vnode.js';
import { renderVNodeWithBindings } from '../../reconciler/jsx-integration.js';
import { defineComponent } from '../../core/component/define.js';

/**
 * Generator options
 */
interface GeneratorOptions {
  mode?: 'development' | 'production' | 'reactive' | 'fast';
  target?: 'browser' | 'node' | 'universal';
  optimize?: {
    removeComments?: boolean;
    minify?: boolean;
    treeshake?: boolean;
  };
}

/**
 * Aether Component Generator
 */
export class AetherComponentGenerator {
  private options: GeneratorOptions;
  private hasReactiveContent: boolean = false;
  private usedComponents: Set<string> = new Set();
  private imports: Set<string> = new Set();
  private scope: Record<string, any> = {};

  constructor(options: GeneratorOptions = {}) {
    this.options = {
      mode: 'production',
      target: 'browser',
      optimize: {
        removeComments: true,
        minify: false,
        treeshake: false
      },
      ...options
    };
  }

  /**
   * Generate component code from VNode tree
   */
  generate(vnodes: VNode[], metadata: {
    hasReactiveContent?: boolean;
    usedComponents?: string[];
    frontmatter?: Record<string, any>;
    scope?: Record<string, any>;
  }): string {
    this.hasReactiveContent = metadata.hasReactiveContent || false;
    this.usedComponents = new Set(metadata.usedComponents || []);
    this.scope = metadata.scope || {};

    // Generate imports
    const imports = this.generateImports();

    // Generate component function
    const componentCode = this.generateComponentFunction(vnodes, metadata.frontmatter);

    // Combine
    return `${imports}\n\n${componentCode}`;
  }

  /**
   * Generate import statements
   */
  private generateImports(): string {
    const imports: string[] = [];

    // Core Aether imports
    imports.push(`import { defineComponent } from '@omnitron-dev/aether/core/component';`);

    // JSX runtime
    if (this.hasReactiveContent) {
      imports.push(`import { createElementVNode, createTextVNode, renderVNodeWithBindings } from '@omnitron-dev/aether/reconciler';`);
    } else {
      imports.push(`import { jsx, jsxs, Fragment } from '@omnitron-dev/aether/jsx-runtime';`);
    }

    // Reactivity imports if needed
    if (this.hasReactiveContent || this.options.mode === 'reactive') {
      imports.push(`import { signal, computed, effect } from '@omnitron-dev/aether/core/reactivity';`);
      imports.push(`import { batch, untrack } from '@omnitron-dev/aether/core/reactivity';`);
    }

    // MDX context
    imports.push(`import { useMDXContext } from '@omnitron-dev/aether/mdx/runtime';`);

    // Add custom imports
    for (const imp of this.imports) {
      imports.push(imp);
    }

    return imports.join('\n');
  }

  /**
   * Generate component function
   */
  private generateComponentFunction(vnodes: VNode[], frontmatter?: Record<string, any>): string {
    const componentName = 'MDXContent';

    // Generate frontmatter export if exists
    const frontmatterExport = frontmatter ?
      `export const frontmatter = ${JSON.stringify(frontmatter, null, 2)};\n\n` : '';

    // Component code based on mode
    if (this.hasReactiveContent || this.options.mode === 'reactive') {
      return `${frontmatterExport}const ${componentName} = defineComponent((props) => {
  // MDX context with components and scope
  const mdxContext = useMDXContext();

  // Merge props with context
  const mergedProps = { ...mdxContext.scope, ...props };

  // Component overrides
  const components = {
    ...mdxContext.components,
    ${Array.from(this.usedComponents).map(name => `${name}: mdxContext.components.${name} || ${name}`).join(',\n    ')}
  };

  // Render function
  return () => {
    ${this.options.mode === 'reactive' ?
      `// Reactive mode - use VNodes for fine-grained updates
    return batch(() => {
      const vnodes = ${this.stringifyVNodes(vnodes)};
      return renderVNodeWithBindings(createElementVNode('div', { class: 'mdx-content' }, vnodes));
    });` :
      `// Static mode - use JSX directly
    return jsx('div', { class: 'mdx-content' }, ${this.generateJSXFromVNodes(vnodes)});`}
  };
});

export default ${componentName};`;
    }

    // Simple static component
    return `${frontmatterExport}const ${componentName} = defineComponent((props) => {
  const mdxContext = useMDXContext();
  const components = mdxContext.components;

  return () => (
    jsx('div', { class: 'mdx-content' }, ${this.generateJSXFromVNodes(vnodes)})
  );
});

export default ${componentName};`;
  }

  /**
   * Stringify VNodes for code generation
   */
  private stringifyVNodes(vnodes: VNode[]): string {
    if (vnodes.length === 0) return '[]';
    if (vnodes.length === 1) {
      const first = vnodes[0];
      return first ? this.stringifyVNode(first) : 'null';
    }
    return `[${vnodes.map(vnode => this.stringifyVNode(vnode)).join(', ')}]`;
  }

  /**
   * Stringify single VNode
   */
  private stringifyVNode(vnode: VNode): string {
    if (vnode.type === 'text') {
      // Check for reactive expression
      if ((vnode as any).data?.isReactive) {
        const expr = (vnode as any).data.expression;
        return `createTextVNode(() => ${expr})`;
      }
      return `createTextVNode(${JSON.stringify(vnode.text)})`;
    }

    if (vnode.type === 'element') {
      const tag = JSON.stringify(vnode.tag);
      const props = this.stringifyProps(vnode.props);
      const children = vnode.children ? this.stringifyVNodes(vnode.children) : 'undefined';
      return `createElementVNode(${tag}, ${props}, ${children})`;
    }

    if (vnode.type === 'component') {
      const component = (vnode.tag as any).name || 'Component';
      const props = this.stringifyProps(vnode.props);
      return `jsx(${component}, ${props})`;
    }

    return 'null';
  }

  /**
   * Stringify props object
   */
  private stringifyProps(props?: Record<string, any>): string {
    if (!props || Object.keys(props).length === 0) {
      return '{}';
    }

    const entries = Object.entries(props).map(([key, value]) => {
      // Handle reactive expressions
      if (value?.__reactive && value?.__expression) {
        return `${JSON.stringify(key)}: () => ${value.__expression}`;
      }
      return `${JSON.stringify(key)}: ${JSON.stringify(value)}`;
    });

    return `{ ${entries.join(', ')} }`;
  }

  /**
   * Generate JSX from VNodes (for static content)
   */
  private generateJSXFromVNodes(vnodes: VNode[]): string {
    if (vnodes.length === 0) return 'null';
    if (vnodes.length === 1) {
      const first = vnodes[0];
      return first ? this.generateJSXFromVNode(first) : 'null';
    }

    // Multiple children
    return `[${vnodes.map((vnode, i) =>
      `${this.generateJSXFromVNode(vnode)}`
    ).join(', ')}]`;
  }

  /**
   * Generate JSX from single VNode
   */
  private generateJSXFromVNode(vnode: VNode): string {
    if (vnode.type === 'text') {
      if ((vnode as any).data?.isReactive) {
        return `{${(vnode as any).data.expression}}`;
      }
      return JSON.stringify(vnode.text);
    }

    if (vnode.type === 'element') {
      const tag = JSON.stringify(vnode.tag);
      const props = vnode.props ? this.stringifyProps(vnode.props) : '{}';
      const children = vnode.children ? this.generateJSXFromVNodes(vnode.children) : 'null';

      if (vnode.children && vnode.children.length > 1) {
        return `jsxs(${tag}, { ...${props}, children: ${children} })`;
      }
      return `jsx(${tag}, { ...${props}, children: ${children} })`;
    }

    if (vnode.type === 'component') {
      const component = (vnode.tag as any).name || 'Component';
      const props = vnode.props ? this.stringifyProps(vnode.props) : '{}';
      return `jsx(${component}, ${props})`;
    }

    return 'null';
  }

  /**
   * Add custom import
   */
  addImport(importStatement: string): void {
    this.imports.add(importStatement);
  }

  /**
   * Set scope variable
   */
  setScopeVariable(name: string, value: any): void {
    this.scope[name] = value;
  }
}

/**
 * Generate Aether component from MDX
 */
export async function generateComponent(
  vnodes: VNode[],
  options: CompileMDXOptions & GeneratorOptions,
  metadata?: {
    hasReactiveContent?: boolean;
    usedComponents?: string[];
    frontmatter?: Record<string, any>;
    scope?: Record<string, any>;
  }
): Promise<string> {
  const generator = new AetherComponentGenerator({
    mode: options.mode as any,
    target: options.target,
    optimize: options.optimize as any
  });

  return generator.generate(vnodes, metadata || {});
}

/**
 * Create MDX module from generated code and VNode tree
 */
export function createMDXModule(
  code: string,
  vnodes: VNode[],
  metadata: {
    frontmatter?: Record<string, any>;
    toc?: any[];
    usedComponents?: string[];
  }
): MDXModule {
  // Create a real component that renders the VNode tree
  const MDXContentComponent = defineComponent((props: any) => () => {
      // Create a wrapper div containing all VNodes
      const wrapperVNode = createElementVNode(
        'div',
        { class: 'mdx-content', ...props },
        vnodes
      );

      // Render the VNode tree with reactive bindings
      return renderVNodeWithBindings(wrapperVNode);
    });

  return {
    code,
    default: MDXContentComponent as any,
    frontmatter: metadata.frontmatter,
    toc: metadata.toc,
    usedComponents: metadata.usedComponents,
    meta: extractMeta(metadata.frontmatter)
  };
}

/**
 * Extract metadata from frontmatter
 */
function extractMeta(frontmatter?: Record<string, any>) {
  if (!frontmatter) return undefined;

  return {
    title: frontmatter.title,
    description: frontmatter.description,
    keywords: frontmatter.keywords || frontmatter.tags,
    author: frontmatter.author,
    date: frontmatter.date ? new Date(frontmatter.date) : undefined
  };
}