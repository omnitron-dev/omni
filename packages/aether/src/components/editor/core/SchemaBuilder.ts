/**
 * SchemaBuilder - Build ProseMirror schema from extensions
 *
 * Combines node and mark specifications from all extensions into a single schema
 */

import { Schema, type NodeSpec, type MarkSpec } from 'prosemirror-model';
import type { IExtension } from './types.js';

/**
 * Base schema with minimal required nodes
 */
const baseNodes: Record<string, NodeSpec> = {
  doc: {
    content: 'block+',
  },
  paragraph: {
    content: 'inline*',
    group: 'block',
    parseDOM: [{ tag: 'p' }],
    toDOM: () => ['p', 0],
  },
  text: {
    group: 'inline',
  },
};

/**
 * Base marks (empty by default, extensions add marks)
 */
const baseMarks: Record<string, MarkSpec> = {};

/**
 * SchemaBuilder class
 *
 * Builds a ProseMirror schema from a collection of extensions
 *
 * @example
 * ```typescript
 * const builder = new SchemaBuilder();
 * builder.addExtensions([boldExtension, italicExtension]);
 * const schema = builder.build();
 * ```
 */
export class SchemaBuilder {
  private nodes: Record<string, NodeSpec> = { ...baseNodes };
  private marks: Record<string, MarkSpec> = { ...baseMarks };

  /**
   * Add a single node specification
   */
  addNode(name: string, spec: NodeSpec): this {
    if (this.nodes[name]) {
      console.warn(`Node "${name}" is already defined. Overwriting.`);
    }
    this.nodes[name] = spec;
    return this;
  }

  /**
   * Add a single mark specification
   */
  addMark(name: string, spec: MarkSpec): this {
    if (this.marks[name]) {
      console.warn(`Mark "${name}" is already defined. Overwriting.`);
    }
    this.marks[name] = spec;
    return this;
  }

  /**
   * Add multiple extensions and collect their schema contributions
   */
  addExtensions(extensions: IExtension[]): this {
    for (const extension of extensions) {
      const schema = extension.getSchema?.();
      if (!schema) continue;

      // Add nodes
      if (schema.nodes) {
        for (const [name, spec] of Object.entries(schema.nodes)) {
          this.addNode(name, spec);
        }
      }

      // Add marks
      if (schema.marks) {
        for (const [name, spec] of Object.entries(schema.marks)) {
          this.addMark(name, spec);
        }
      }
    }

    return this;
  }

  /**
   * Build the final schema
   */
  build(): Schema {
    return new Schema({
      nodes: this.nodes,
      marks: this.marks,
    });
  }

  /**
   * Get the current node specifications
   */
  getNodes(): Record<string, NodeSpec> {
    return { ...this.nodes };
  }

  /**
   * Get the current mark specifications
   */
  getMarks(): Record<string, MarkSpec> {
    return { ...this.marks };
  }

  /**
   * Reset to base schema
   */
  reset(): this {
    this.nodes = { ...baseNodes };
    this.marks = { ...baseMarks };
    return this;
  }
}
