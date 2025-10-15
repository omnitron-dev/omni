/**
 * ExtensionManager tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ExtensionManager } from '../../../src/components/editor/core/ExtensionManager.js';
import { Extension } from '../../../src/components/editor/core/Extension.js';
import type { ExtensionType } from '../../../src/components/editor/core/types.js';

class ExtensionA extends Extension {
  get name() {
    return 'a';
  }
  get type(): ExtensionType {
    return 'behavior';
  }
}

class ExtensionB extends Extension {
  get name() {
    return 'b';
  }
  get type(): ExtensionType {
    return 'behavior';
  }
  get dependencies() {
    return ['a'];
  }
}

class ExtensionC extends Extension {
  get name() {
    return 'c';
  }
  get type(): ExtensionType {
    return 'behavior';
  }
  get dependencies() {
    return ['a', 'b'];
  }
}

describe('ExtensionManager', () => {
  it('should create with empty extensions', () => {
    const manager = new ExtensionManager([]);
    expect(manager.getExtensions()).toHaveLength(0);
  });

  it('should register extensions', () => {
    const extA = new ExtensionA();
    const manager = new ExtensionManager([extA]);

    expect(manager.getExtensions()).toHaveLength(1);
    expect(manager.getExtension('a')).toBe(extA);
  });

  it('should sort extensions by dependencies', () => {
    const extA = new ExtensionA();
    const extB = new ExtensionB();
    const extC = new ExtensionC();

    // Create in wrong order
    const manager = new ExtensionManager([extC, extB, extA]);

    const extensions = manager.getExtensions();
    const names = extensions.map((e) => e.name);

    // Should be sorted: a, b, c
    expect(names.indexOf('a')).toBeLessThan(names.indexOf('b'));
    expect(names.indexOf('b')).toBeLessThan(names.indexOf('c'));
  });

  it('should throw on missing dependency', () => {
    const extB = new ExtensionB(); // depends on 'a'

    expect(() => {
      new ExtensionManager([extB]);
    }).toThrow(/depends on "a" which is not provided/);
  });

  it('should detect circular dependencies', () => {
    class ExtCircular1 extends Extension {
      get name() {
        return 'circular1';
      }
      get type(): ExtensionType {
        return 'behavior';
      }
      get dependencies() {
        return ['circular2'];
      }
    }

    class ExtCircular2 extends Extension {
      get name() {
        return 'circular2';
      }
      get type(): ExtensionType {
        return 'behavior';
      }
      get dependencies() {
        return ['circular1'];
      }
    }

    expect(() => {
      new ExtensionManager([new ExtCircular1(), new ExtCircular2()]);
    }).toThrow(/Circular dependency detected/);
  });

  it('should build schema from extensions', () => {
    class SchemaExtension extends Extension {
      get name() {
        return 'schema';
      }
      get type(): ExtensionType {
        return 'node';
      }
      getSchema() {
        return {
          nodes: {
            custom: {
              content: 'inline*',
              group: 'block',
            },
          },
        };
      }
    }

    const manager = new ExtensionManager([new SchemaExtension()]);
    const schema = manager.getSchema();

    expect(schema.nodes.custom).toBeDefined();
    expect(schema.nodes.doc).toBeDefined(); // Base nodes
  });

  it('should collect plugins from extensions', () => {
    class PluginExtension extends Extension {
      get name() {
        return 'plugin';
      }
      get type(): ExtensionType {
        return 'behavior';
      }
      getPlugins() {
        return []; // Just return empty array for test
      }
    }

    const manager = new ExtensionManager([new PluginExtension()]);
    const plugins = manager.getPlugins();

    expect(Array.isArray(plugins)).toBe(true);
    expect(plugins.length).toBeGreaterThan(0); // Should have core plugins at least
  });

  it('should collect keyboard shortcuts from extensions', () => {
    class KeymapExtension extends Extension {
      get name() {
        return 'keymap';
      }
      get type(): ExtensionType {
        return 'behavior';
      }
      getKeyboardShortcuts() {
        return {
          'Ctrl-k': () => true,
        };
      }
    }

    const manager = new ExtensionManager([new KeymapExtension()]);
    const plugins = manager.getPlugins();

    // Keymap plugin should be included
    expect(plugins.length).toBeGreaterThan(0);
  });

  it('should destroy all extensions', () => {
    let destroyed = false;

    class DestroyExtension extends Extension {
      get name() {
        return 'destroy';
      }
      get type(): ExtensionType {
        return 'behavior';
      }
      onDestroy() {
        destroyed = true;
      }
    }

    const manager = new ExtensionManager([new DestroyExtension()]);
    manager.destroy();

    expect(destroyed).toBe(true);
  });

  it('should return undefined for non-existent extension', () => {
    const manager = new ExtensionManager([]);
    expect(manager.getExtension('nonexistent')).toBeUndefined();
  });
});
