/**
 * MDX Parser
 *
 * Parser implementation based on unified ecosystem for MDX content
 */

import { unified, type Processor } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkFrontmatter from 'remark-frontmatter';
import remarkDirective from 'remark-directive';
import { remarkCustomHeadingId } from '../plugins/remark-custom-heading-id.js';
import { preprocessHeadingIds } from '../plugins/preprocess-heading-ids.js';
import type { Root as MdastRoot } from 'mdast';
import type { CompileMDXOptions, MDXNode } from '../types.js';

/**
 * Parser options
 */
export interface ParserOptions {
  /** Enable MDX JSX support */
  jsx?: boolean;
  /** JSX import source */
  jsxImportSource?: string;
  /** GitHub Flavored Markdown */
  gfm?: boolean;
  /** Math support */
  math?: boolean;
  /** Frontmatter support */
  frontmatter?: boolean;
  /** Directive support */
  directives?: boolean;
  /** Custom remark plugins */
  remarkPlugins?: any[];
}

/**
 * Create a unified processor with configured plugins
 */
function createProcessor(options: ParserOptions): Processor<MdastRoot, undefined, undefined, MdastRoot, string> {
  let processor: Processor<any, any, any, any, any> = unified().use(remarkParse);

  // MDX support (must be after remarkParse)
  if (options.jsx !== false) {
    processor = processor.use(remarkMdx as any);
  }

  // Custom heading ID plugin (must be AFTER remarkMdx so it can find mdxTextExpression nodes)
  processor = processor.use(remarkCustomHeadingId as any);

  // GitHub Flavored Markdown
  if (options.gfm) {
    processor = processor.use(remarkGfm as any);
  }

  // Math support
  if (options.math) {
    processor = processor.use(remarkMath as any);
  }

  // Frontmatter (YAML/TOML)
  if (options.frontmatter) {
    processor = processor.use(remarkFrontmatter as any, ['yaml', 'toml']);
  }

  // Directives (:::note, ::highlight, etc.)
  if (options.directives) {
    processor = processor.use(remarkDirective as any);
  }

  // Custom plugins
  if (options.remarkPlugins) {
    for (const plugin of options.remarkPlugins) {
      if (Array.isArray(plugin)) {
        processor = processor.use(plugin[0] as any, plugin[1]);
      } else {
        processor = processor.use(plugin as any);
      }
    }
  }

  return processor as Processor<MdastRoot, undefined, undefined, MdastRoot, string>;
}

/**
 * MDX Parser class
 */
export class AetherMDXParser {
  private processor: Processor<MdastRoot, undefined, undefined, MdastRoot, string>;
  private options: ParserOptions;
  private headingIds: Map<string, number>;

  constructor(options: ParserOptions = {}) {
    this.options = {
      jsx: true,
      gfm: true,
      frontmatter: true,
      math: false,
      directives: false,
      ...options,
    };
    this.processor = createProcessor(this.options);
    this.headingIds = new Map();
  }

  /**
   * Parse MDX content to AST
   */
  parse(content: string): MdastRoot {
    // Preprocess to handle {#id} syntax
    const preprocessed = preprocessHeadingIds(content);
    const file = this.processor.parse(preprocessed);
    return file as MdastRoot;
  }

  /**
   * Parse MDX content asynchronously
   */
  async parseAsync(content: string): Promise<MdastRoot> {
    // Preprocess to handle {#id} syntax
    const preprocessed = preprocessHeadingIds(content);
    const file = await this.processor.run(this.processor.parse(preprocessed));
    return file as MdastRoot;
  }

  /**
   * Transform MDAST to MDXNode format for Aether
   */
  transformToMDXNode(mdast: any): MDXNode {
    // Reset heading IDs for each transformation
    this.headingIds.clear();
    return this.convertNode(mdast);
  }

  /**
   * Convert MDAST node to MDXNode
   */
  private convertNode(node: any): MDXNode {
    const mdxNode: MDXNode = {
      type: this.mapNodeType(node.type),
      position: node.position,
    };

    // Handle different node types
    switch (node.type) {
      case 'text':
        mdxNode.value = node.value;
        break;

      case 'element':
      case 'mdxJsxFlowElement':
      case 'mdxJsxTextElement':
        mdxNode.tagName = node.name || node.tagName;
        mdxNode.attributes = this.convertAttributes(node.attributes || node.properties);
        mdxNode.children = this.convertChildren(node.children);
        break;

      case 'mdxFlowExpression':
      case 'mdxTextExpression':
        mdxNode.value = node.value;
        if (node.data?.estree) {
          mdxNode.data = { estree: node.data.estree };
        }
        break;

      // MDAST-specific nodes
      case 'heading': {
        mdxNode.tagName = `h${node.depth || 1}`;
        mdxNode.children = this.convertChildren(node.children);
        // Check if custom ID is provided via remark plugin
        let headingId: string;
        if (node.data?.hProperties?.id || node.data?.id) {
          // Use custom ID from {#id} syntax
          headingId = node.data.hProperties?.id || node.data.id;
          // Note: Don't call generateUniqueId as the custom ID should be used as-is
        } else {
          // Generate ID from text
          const headingText = this.extractText(node);
          headingId = this.generateUniqueId(headingText);
        }
        mdxNode.attributes = [{ type: 'mdxJsxAttribute' as const, name: 'id', value: headingId }];
        break;
      }

      case 'paragraph':
        mdxNode.tagName = 'p';
        mdxNode.children = this.convertChildren(node.children);
        break;

      case 'strong':
        mdxNode.tagName = 'strong';
        mdxNode.children = this.convertChildren(node.children);
        break;

      case 'emphasis':
        mdxNode.tagName = 'em';
        mdxNode.children = this.convertChildren(node.children);
        break;

      case 'list':
        mdxNode.tagName = node.ordered ? 'ol' : 'ul';
        mdxNode.children = this.convertChildren(node.children);
        break;

      case 'listItem':
        mdxNode.tagName = 'li';
        mdxNode.children = this.convertChildren(node.children);
        break;

      case 'link':
        mdxNode.tagName = 'a';
        mdxNode.attributes = [{ type: 'mdxJsxAttribute', name: 'href', value: node.url }];
        mdxNode.children = this.convertChildren(node.children);
        break;

      case 'code':
        mdxNode.tagName = 'code';
        mdxNode.value = node.value;
        if (node.lang) {
          mdxNode.attributes = [{ type: 'mdxJsxAttribute', name: 'class', value: `language-${node.lang}` }];
        }
        break;

      case 'inlineCode':
        mdxNode.tagName = 'code';
        mdxNode.value = node.value;
        break;

      case 'blockquote':
        mdxNode.tagName = 'blockquote';
        mdxNode.children = this.convertChildren(node.children);
        break;

      case 'table':
        mdxNode.tagName = 'table';
        mdxNode.children = this.convertChildren(node.children);
        break;

      case 'tableRow':
        mdxNode.tagName = 'tr';
        mdxNode.children = this.convertChildren(node.children);
        break;

      case 'tableCell':
        mdxNode.tagName = 'td';
        mdxNode.children = this.convertChildren(node.children);
        break;

      case 'root':
        // Root node should be converted to a fragment or div
        mdxNode.tagName = 'div';
        mdxNode.children = this.convertChildren(node.children);
        break;

      default:
        // For other node types, convert children if they exist
        if (node.children) {
          mdxNode.children = this.convertChildren(node.children);
        }
        if (node.value !== undefined) {
          mdxNode.value = node.value;
        }
    }

    return mdxNode;
  }

  /**
   * Map MDAST node types to MDXNode types
   */
  private mapNodeType(type: string): MDXNode['type'] {
    switch (type) {
      case 'text':
        return 'text';
      case 'element':
        return 'element';
      case 'mdxJsxFlowElement':
        return 'mdxJsxFlowElement';
      case 'mdxJsxTextElement':
        return 'mdxJsxTextElement';
      case 'mdxFlowExpression':
        return 'mdxFlowExpression';
      case 'mdxTextExpression':
        return 'mdxTextExpression';
      default:
        return 'element';
    }
  }

  /**
   * Convert attributes
   */
  private convertAttributes(attrs: any): MDXNode['attributes'] {
    if (!attrs) return undefined;

    if (Array.isArray(attrs)) {
      return attrs.map((attr) => ({
        type: 'mdxJsxAttribute' as const,
        name: attr.name,
        value: attr.value,
      }));
    }

    // Convert object properties to attributes
    return Object.entries(attrs).map(([name, value]) => ({
      type: 'mdxJsxAttribute' as const,
      name,
      value: value as any,
    }));
  }

  /**
   * Convert children nodes
   */
  private convertChildren(children: any[]): MDXNode[] | undefined {
    if (!children || children.length === 0) return undefined;
    return children.map((child) => this.convertNode(child));
  }

  /**
   * Extract frontmatter from AST
   */
  extractFrontmatter(ast: MdastRoot): Record<string, any> | undefined {
    const frontmatterNode = ast.children.find((node: any) => node.type === 'yaml' || node.type === 'toml') as
      | { type: 'yaml' | 'toml'; value: string }
      | undefined;

    if (!frontmatterNode) return undefined;

    try {
      if (frontmatterNode.type === 'yaml') {
        // In production, use a YAML parser
        // For now, return a mock object
        return this.parseYAML(frontmatterNode.value);
      } else if (frontmatterNode.type === 'toml') {
        // In production, use a TOML parser
        return this.parseTOML(frontmatterNode.value);
      }
    } catch (error) {
      console.warn('Failed to parse frontmatter:', error);
    }

    return undefined;
  }

  /**
   * Parse YAML frontmatter (simplified)
   */
  private parseYAML(content: string): Record<string, any> {
    // Simplified YAML parsing - in production use proper YAML parser
    const result: Record<string, any> = {};
    const lines = content.split('\n');

    for (const line of lines) {
      const match = line.match(/^(\w+):\s*(.*)$/);
      if (match && match[1] && match[2] !== undefined) {
        const key = match[1];
        const value = match[2];
        // Try to parse as JSON, fallback to string
        try {
          result[key] = JSON.parse(value);
        } catch {
          result[key] = value.trim();
        }
      }
    }

    return result;
  }

  /**
   * Parse TOML frontmatter (simplified)
   */
  private parseTOML(content: string): Record<string, any> {
    // Simplified TOML parsing - in production use proper TOML parser
    const result: Record<string, any> = {};
    const lines = content.split('\n');

    for (const line of lines) {
      const match = line.match(/^(\w+)\s*=\s*(.*)$/);
      if (match && match[1] && match[2] !== undefined) {
        const key = match[1];
        const value = match[2];
        // Try to parse value
        if (value.startsWith('"') && value.endsWith('"')) {
          result[key] = value.slice(1, -1);
        } else if (value === 'true' || value === 'false') {
          result[key] = value === 'true';
        } else if (!isNaN(Number(value))) {
          result[key] = Number(value);
        } else {
          result[key] = value;
        }
      }
    }

    return result;
  }

  /**
   * Extract table of contents from AST
   */
  extractTOC(ast: MdastRoot): Array<{ level: number; title: string; id: string }> {
    const toc: Array<{ level: number; title: string; id: string }> = [];

    const visit = (node: any) => {
      if (node.type === 'heading') {
        const title = this.extractText(node);
        // Use custom ID if available, otherwise generate from title
        const id = node.data?.hProperties?.id || node.data?.id || this.generateId(title);
        toc.push({
          level: node.depth,
          title,
          id,
        });
      }

      if (node.children) {
        for (const child of node.children) {
          visit(child);
        }
      }
    };

    visit(ast);
    return toc;
  }

  /**
   * Extract text content from node
   */
  private extractText(node: any): string {
    if (node.type === 'text') {
      return node.value;
    }

    if (node.children) {
      return node.children.map((child: any) => this.extractText(child)).join('');
    }

    return '';
  }

  /**
   * Generate ID from text
   */
  private generateId(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .trim();
  }

  /**
   * Generate unique ID from text, handling duplicates
   */
  private generateUniqueId(text: string): string {
    const baseId = this.generateId(text);

    // Check if this ID has been used before
    const count = this.headingIds.get(baseId);

    if (count === undefined) {
      // First time using this ID
      this.headingIds.set(baseId, 1);
      return baseId;
    } else {
      // ID already used, append counter
      const newCount = count + 1;
      this.headingIds.set(baseId, newCount);
      return `${baseId}-${newCount}`;
    }
  }
}

/**
 * Create a parser instance with options
 */
export function createParser(options: CompileMDXOptions = {}): AetherMDXParser {
  return new AetherMDXParser({
    jsx: options.jsx,
    jsxImportSource: options.jsxImportSource,
    gfm: options.gfm,
    math: options.math,
    frontmatter: options.frontmatter,
    directives: options.directives,
    remarkPlugins: options.remarkPlugins,
  });
}
