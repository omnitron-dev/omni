/**
 * SchemaBuilder tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SchemaBuilder } from '../../../src/components/editor/core/SchemaBuilder.js';
import { Extension } from '../../../src/components/editor/core/Extension.js';
import type { ExtensionType } from '../../../src/components/editor/core/types.js';

class TestNodeExtension extends Extension {
  get name() {
    return 'testNode';
  }
  get type(): ExtensionType {
    return 'node';
  }

  getSchema() {
    return {
      nodes: {
        heading: {
          content: 'inline*',
          group: 'block',
          attrs: { level: { default: 1 } },
        },
      },
    };
  }
}

class TestMarkExtension extends Extension {
  get name() {
    return 'testMark';
  }
  get type(): ExtensionType {
    return 'mark';
  }

  getSchema() {
    return {
      marks: {
        bold: {
          parseDOM: [{ tag: 'strong' }],
          toDOM: () => ['strong', 0],
        },
      },
    };
  }
}

describe('SchemaBuilder', () => {
  let builder: SchemaBuilder;

  beforeEach(() => {
    builder = new SchemaBuilder();
  });

  it('should create a builder instance', () => {
    expect(builder).toBeInstanceOf(SchemaBuilder);
  });

  it('should have base nodes by default', () => {
    const nodes = builder.getNodes();
    expect(nodes.doc).toBeDefined();
    expect(nodes.paragraph).toBeDefined();
    expect(nodes.text).toBeDefined();
  });

  it('should add a custom node', () => {
    builder.addNode('custom', {
      content: 'inline*',
      group: 'block',
    });

    const nodes = builder.getNodes();
    expect(nodes.custom).toBeDefined();
  });

  it('should add a custom mark', () => {
    builder.addMark('custom', {
      parseDOM: [{ tag: 'em' }],
      toDOM: () => ['em', 0],
    });

    const marks = builder.getMarks();
    expect(marks.custom).toBeDefined();
  });

  it('should add extensions and collect their schema', () => {
    const nodeExt = new TestNodeExtension();
    const markExt = new TestMarkExtension();

    builder.addExtensions([nodeExt, markExt]);

    const nodes = builder.getNodes();
    const marks = builder.getMarks();

    expect(nodes.heading).toBeDefined();
    expect(marks.bold).toBeDefined();
  });

  it('should build a valid schema', () => {
    const schema = builder.build();

    expect(schema).toBeDefined();
    expect(schema.nodes.doc).toBeDefined();
    expect(schema.nodes.paragraph).toBeDefined();
    expect(schema.nodes.text).toBeDefined();
  });

  it('should allow chaining methods', () => {
    const result = builder
      .addNode('custom1', { group: 'block' })
      .addMark('custom2', { toDOM: () => ['span', 0] })
      .build();

    expect(result).toBeDefined();
  });

  it('should reset to base schema', () => {
    builder.addNode('custom', { group: 'block' });
    expect(builder.getNodes().custom).toBeDefined();

    builder.reset();
    expect(builder.getNodes().custom).toBeUndefined();
    expect(builder.getNodes().doc).toBeDefined();
  });

  it('should warn when overwriting existing nodes', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    builder.addNode('paragraph', { group: 'block' });
    builder.addNode('paragraph', { group: 'block' });

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Node "paragraph" is already defined'));

    consoleSpy.mockRestore();
  });

  it('should warn when overwriting existing marks', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    builder.addMark('bold', { toDOM: () => ['strong', 0] });
    builder.addMark('bold', { toDOM: () => ['b', 0] });

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Mark "bold" is already defined'));

    consoleSpy.mockRestore();
  });
});
