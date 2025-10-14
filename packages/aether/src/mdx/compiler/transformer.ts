/**
 * MDX AST Transformer
 *
 * Transforms MDX AST nodes to Aether-compatible structures
 */

import type { MDXNode, AetherMDXPlugin } from '../types.js';
import { createTextVNode, createElementVNode, type VNode } from '../../reconciler/vnode.js';
import { isSignal } from '../../core/reactivity/signal.js';

/**
 * Transform context for passing data through transformation
 */
interface TransformContext {
  /** Detected reactive expressions */
  reactiveExpressions: Set<string>;
  /** Used components */
  usedComponents: Set<string>;
  /** Plugins */
  plugins: AetherMDXPlugin[];
  /** Scope variables */
  scope: Record<string, any>;
  /** Component overrides */
  components: Record<string, any>;
}

/**
 * MDX to VNode Transformer
 */
export class MDXToVNodeTransformer {
  private context: TransformContext;

  constructor(options: {
    plugins?: AetherMDXPlugin[];
    scope?: Record<string, any>;
    components?: Record<string, any>;
  } = {}) {
    this.context = {
      reactiveExpressions: new Set(),
      usedComponents: new Set(),
      plugins: options.plugins || [],
      scope: options.scope || {},
      components: options.components || {}
    };
  }

  /**
   * Transform MDX node to VNode
   */
  async transform(mdxNode: MDXNode): Promise<VNode | null> {
    // Apply plugin transformations first
    let node = mdxNode;
    for (const plugin of this.context.plugins) {
      if (plugin.transformAether) {
        const result = await plugin.transformAether(node);
        if (result === null || result === undefined) {
          return null;
        }
        node = result;
      }
    }

    // Transform based on node type
    switch (node.type) {
      case 'element':
        return await this.transformElement(node);
      case 'text':
        return this.transformText(node);
      case 'mdxJsxFlowElement':
      case 'mdxJsxTextElement':
        return await this.transformJSXElement(node);
      case 'mdxFlowExpression':
      case 'mdxTextExpression':
        return this.transformExpression(node);
      default:
        // Unknown node type, try to render children if any
        if (node.children) {
          const children = await this.transformChildren(node.children);
          return createElementVNode('div', {}, children);
        }
        return null;
    }
  }

  /**
   * Transform element node
   */
  private async transformElement(node: MDXNode): Promise<VNode> {
    const children = node.children ? await this.transformChildren(node.children) : undefined;
    const props = this.extractProps(node);

    // Check if this is a component override
    const Component = this.context.components[node.tagName!];
    if (Component) {
      this.context.usedComponents.add(node.tagName!);
      // Return component VNode
      return {
        type: 'component' as any,
        tag: Component,
        props: { ...props, children },
        key: props.key,
        dom: null,
        effects: []
      };
    }

    // Detect reactive props
    const hasReactiveProps = this.detectReactiveProps(props);
    if (hasReactiveProps) {
      this.context.reactiveExpressions.add(node.tagName!);
    }

    return createElementVNode(node.tagName!, props, children);
  }

  /**
   * Transform text node
   */
  private transformText(node: MDXNode): VNode {
    return createTextVNode(node.value || '');
  }

  /**
   * Transform JSX element
   */
  private async transformJSXElement(node: MDXNode): Promise<VNode> {
    const children = node.children ? await this.transformChildren(node.children) : undefined;
    const props = this.extractProps(node);

    // Check if component exists in scope or components
    const componentName = node.tagName!;
    const Component = this.context.components[componentName] || this.context.scope[componentName];

    if (Component) {
      this.context.usedComponents.add(componentName);
      return {
        type: 'component' as any,
        tag: Component,
        props: { ...props, children },
        key: props.key,
        dom: null,
        effects: []
      };
    }

    // Fall back to HTML element
    return createElementVNode(componentName.toLowerCase(), props, children);
  }

  /**
   * Transform expression node
   */
  private transformExpression(node: MDXNode): VNode {
    const expression = node.value || '';

    // Mark as reactive
    this.context.reactiveExpressions.add(expression);

    // Create a text VNode with reactive binding
    const vnode: VNode = {
      type: 'text' as any,
      text: '',
      dom: null,
      effects: [],
      // Store the expression for later evaluation
      data: {
        expression,
        isReactive: true
      }
    } as any;

    return vnode;
  }

  /**
   * Transform children nodes
   */
  private async transformChildren(children: MDXNode[]): Promise<VNode[]> {
    const vnodes: VNode[] = [];

    for (const child of children) {
      const vnode = await this.transform(child);
      if (vnode) {
        vnodes.push(vnode);
      }
    }

    return vnodes;
  }

  /**
   * Extract props from node attributes
   */
  private extractProps(node: MDXNode): Record<string, any> {
    if (!node.attributes) {
      return {};
    }

    const props: Record<string, any> = {};

    for (const attr of node.attributes) {
      const value = this.resolveAttributeValue(attr.value);

      // Handle special attributes
      if (attr.name === 'className') {
        props.class = value;
      } else if (attr.name === 'htmlFor') {
        props.for = value;
      } else {
        props[attr.name] = value;
      }
    }

    return props;
  }

  /**
   * Resolve attribute value
   */
  private resolveAttributeValue(value: any): any {
    if (typeof value === 'object' && value?.type === 'expression') {
      // Mark as reactive expression
      this.context.reactiveExpressions.add(value.value);
      // Return a marker for reactive binding
      return { __expression: value.value, __reactive: true };
    }

    return value;
  }

  /**
   * Detect if props contain reactive values
   */
  private detectReactiveProps(props: Record<string, any>): boolean {
    for (const value of Object.values(props)) {
      if (this.isReactiveValue(value)) {
        return true;
      }

      // Check nested values
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        for (const nestedValue of Object.values(value)) {
          if (this.isReactiveValue(nestedValue)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Check if value is reactive
   */
  private isReactiveValue(value: any): boolean {
    // Check for signal
    if (isSignal(value)) {
      return true;
    }

    // Check for expression marker
    if (value?.__reactive || value?.__expression) {
      return true;
    }

    return false;
  }

  /**
   * Get transformation metadata
   */
  getMetadata() {
    return {
      reactiveExpressions: Array.from(this.context.reactiveExpressions),
      usedComponents: Array.from(this.context.usedComponents),
      hasReactiveContent: this.context.reactiveExpressions.size > 0
    };
  }
}

/**
 * Transform pipeline for processing AST through multiple stages
 */
export class TransformPipeline {
  private remarkPlugins: any[] = [];
  private rehypePlugins: any[] = [];
  private aetherTransforms: AetherMDXPlugin[] = [];

  /**
   * Add remark plugin
   */
  useRemark(plugin: any, options?: any): this {
    this.remarkPlugins.push(options ? [plugin, options] : plugin);
    return this;
  }

  /**
   * Add rehype plugin
   */
  useRehype(plugin: any, options?: any): this {
    this.rehypePlugins.push(options ? [plugin, options] : plugin);
    return this;
  }

  /**
   * Add Aether transform
   */
  useAether(transform: AetherMDXPlugin): this {
    this.aetherTransforms.push(transform);
    return this;
  }

  /**
   * Get configured plugins
   */
  getPlugins() {
    return {
      remarkPlugins: this.remarkPlugins,
      rehypePlugins: this.rehypePlugins,
      aetherPlugins: this.aetherTransforms
    };
  }

  /**
   * Create transformer with pipeline configuration
   */
  createTransformer(options?: {
    scope?: Record<string, any>;
    components?: Record<string, any>;
  }): MDXToVNodeTransformer {
    return new MDXToVNodeTransformer({
      ...options,
      plugins: this.aetherTransforms
    });
  }
}

/**
 * Built-in reactive content transform
 */
export class ReactiveContentTransform implements AetherMDXPlugin {
  name = 'aether-reactive-content';

  async transformAether(node: MDXNode): Promise<MDXNode> {
    // Mark expressions as reactive
    if (node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression') {
      return {
        ...node,
        data: {
          ...node.data,
          reactive: true
        }
      };
    }

    // Process JSX elements with expressions in props
    if ((node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && node.attributes) {
      const transformedAttributes = node.attributes.map(attr => {
        if (typeof attr.value === 'object' && attr.value?.type === 'expression') {
          return {
            ...attr,
            value: {
              ...attr.value,
              data: {
                ...attr.value.data,
                reactive: true
              }
            }
          };
        }
        return attr;
      });

      return {
        ...node,
        attributes: transformedAttributes
      };
    }

    return node;
  }
}