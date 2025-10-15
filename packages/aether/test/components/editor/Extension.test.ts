/**
 * Extension class tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Extension } from '../../../src/components/editor/core/Extension.js';
import type { IExtension, ExtensionType } from '../../../src/components/editor/core/types.js';

// Create a test extension
class TestExtension extends Extension<{ option1: string; option2: number }> {
  get name() {
    return 'test';
  }

  get type(): ExtensionType {
    return 'behavior';
  }

  protected defaultOptions() {
    return {
      option1: 'default',
      option2: 42,
    };
  }

  getSchema() {
    return {
      nodes: {
        test_node: {
          content: 'inline*',
          group: 'block',
        },
      },
    };
  }

  getKeyboardShortcuts() {
    return {
      'Ctrl-t': () => true,
    };
  }
}

describe('Extension', () => {
  let extension: TestExtension;

  beforeEach(() => {
    extension = new TestExtension();
  });

  it('should have a name', () => {
    expect(extension.name).toBe('test');
  });

  it('should have a type', () => {
    expect(extension.type).toBe('behavior');
  });

  it('should use default options when no options provided', () => {
    const options = extension.getOptions();
    expect(options.option1).toBe('default');
    expect(options.option2).toBe(42);
  });

  it('should merge provided options with defaults', () => {
    const ext = new TestExtension({ option1: 'custom' });
    const options = ext.getOptions();
    expect(options.option1).toBe('custom');
    expect(options.option2).toBe(42);
  });

  it('should allow configuring options after creation', () => {
    extension.configure({ option2: 100 });
    const options = extension.getOptions();
    expect(options.option1).toBe('default');
    expect(options.option2).toBe(100);
  });

  it('should provide schema contribution', () => {
    const schema = extension.getSchema();
    expect(schema).toBeDefined();
    expect(schema?.nodes?.test_node).toBeDefined();
  });

  it('should provide keyboard shortcuts', () => {
    const shortcuts = extension.getKeyboardShortcuts();
    expect(shortcuts).toBeDefined();
    expect(shortcuts?.['Ctrl-t']).toBeDefined();
  });

  it('should handle dependencies', () => {
    class DependentExtension extends Extension {
      get name() {
        return 'dependent';
      }
      get type(): ExtensionType {
        return 'behavior';
      }
      get dependencies() {
        return ['test'];
      }
    }

    const ext = new DependentExtension();
    expect(ext.dependencies).toContain('test');
  });

  it('should implement IExtension interface', () => {
    const ext: IExtension = extension;
    expect(ext.name).toBe('test');
    expect(ext.type).toBe('behavior');
    expect(typeof ext.configure).toBe('function');
    expect(typeof ext.getOptions).toBe('function');
  });
});
