/**
 * CollaborationExtension tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { Schema } from 'prosemirror-model';
import * as Y from 'yjs';
import { CollaborationExtension } from '../../../../../src/components/editor/extensions/collaboration/CollaborationExtension.js';
import { SchemaBuilder } from '../../../../../src/components/editor/core/SchemaBuilder.js';

describe('CollaborationExtension', () => {
  let extension: CollaborationExtension;
  let schema: Schema;
  let ydoc: Y.Doc;

  beforeEach(() => {
    ydoc = new Y.Doc();
    extension = new CollaborationExtension({ document: ydoc });
    const builder = new SchemaBuilder();
    schema = builder.build();
  });

  afterEach(() => {
    extension.destroy();
    ydoc.destroy();
  });

  describe('Extension metadata', () => {
    it('should have correct name', () => {
      expect(extension.name).toBe('collaboration');
    });

    it('should have correct type', () => {
      expect(extension.type).toBe('behavior');
    });

    it('should not have dependencies', () => {
      expect(extension.dependencies).toBeUndefined();
    });
  });

  describe('Default options', () => {
    it('should have default provider type', () => {
      const options = extension.getOptions();
      expect(options.provider).toBe('websocket');
    });

    it('should show cursors by default', () => {
      const options = extension.getOptions();
      expect(options.showCursors).toBe(true);
    });

    it('should show selections by default', () => {
      const options = extension.getOptions();
      expect(options.showSelections).toBe(true);
    });

    it('should have default debounce of 100ms', () => {
      const options = extension.getOptions();
      expect(options.debounceMs).toBe(100);
    });

    it('should have default username', () => {
      const options = extension.getOptions();
      expect(options.username).toBe('Anonymous');
    });

    it('should have default user color', () => {
      const options = extension.getOptions();
      expect(options.userColor).toBe('#0066cc');
    });
  });

  describe('Custom options', () => {
    it('should accept custom Y.Doc', () => {
      const customDoc = new Y.Doc();
      const customExtension = new CollaborationExtension({ document: customDoc });
      customExtension.onCreate();

      expect(customExtension.getDocument()).toBe(customDoc);
      customExtension.destroy();
      customDoc.destroy();
    });

    it('should accept custom provider type', () => {
      const customExtension = new CollaborationExtension({ provider: 'webrtc' });
      const options = customExtension.getOptions();
      expect(options.provider).toBe('webrtc');
    });

    it('should accept custom username', () => {
      const customExtension = new CollaborationExtension({ username: 'Alice' });
      const options = customExtension.getOptions();
      expect(options.username).toBe('Alice');
    });

    it('should accept custom user color', () => {
      const customExtension = new CollaborationExtension({ userColor: '#ff0000' });
      const options = customExtension.getOptions();
      expect(options.userColor).toBe('#ff0000');
    });

    it('should accept custom debounce time', () => {
      const customExtension = new CollaborationExtension({ debounceMs: 200 });
      const options = customExtension.getOptions();
      expect(options.debounceMs).toBe(200);
    });

    it('should configure options after creation', () => {
      extension.configure({ username: 'Bob' });
      const options = extension.getOptions();
      expect(options.username).toBe('Bob');
    });
  });

  describe('Y.js document integration', () => {
    it('should create Y.Doc if not provided', () => {
      const noDocExtension = new CollaborationExtension();
      noDocExtension.onCreate();

      const doc = noDocExtension.getDocument();
      expect(doc).toBeInstanceOf(Y.Doc);

      noDocExtension.destroy();
    });

    it('should use provided Y.Doc', () => {
      extension.onCreate();
      const doc = extension.getDocument();
      expect(doc).toBe(ydoc);
    });

    it('should create XML fragment', () => {
      extension.onCreate();
      const fragment = extension.getFragment();
      expect(fragment).toBeDefined();
      expect(fragment).toBeInstanceOf(Y.XmlFragment);
    });

    it('should use "prosemirror" fragment name', () => {
      extension.onCreate();
      const fragment = extension.getFragment();
      expect(fragment).toBe(ydoc.getXmlFragment('prosemirror'));
    });

    it('should destroy Y.Doc if created internally', () => {
      const autoDocExtension = new CollaborationExtension();
      autoDocExtension.onCreate();

      const doc = autoDocExtension.getDocument();
      const destroySpy = vi.spyOn(doc, 'destroy');

      autoDocExtension.destroy();
      expect(destroySpy).toHaveBeenCalled();
    });

    it('should not destroy provided Y.Doc', () => {
      extension.onCreate();
      const destroySpy = vi.spyOn(ydoc, 'destroy');

      extension.destroy();
      expect(destroySpy).not.toHaveBeenCalled();
    });
  });

  describe('Plugins', () => {
    it('should provide y-prosemirror plugins', () => {
      extension.onCreate();
      const plugins = extension.getPlugins();

      expect(plugins).toBeDefined();
      expect(Array.isArray(plugins)).toBe(true);
      expect(plugins.length).toBeGreaterThan(0);
    });

    it('should include ySyncPlugin', () => {
      extension.onCreate();
      const plugins = extension.getPlugins();

      // ySyncPlugin should be present - check that we have plugins
      expect(plugins.length).toBeGreaterThan(0);
      // The first plugin should be the ySyncPlugin
      expect(plugins[0]).toBeDefined();
    });

    it('should include yUndoPlugin', () => {
      extension.onCreate();
      const plugins = extension.getPlugins();

      // yUndoPlugin should be present
      expect(plugins.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Keyboard shortcuts', () => {
    it('should provide Mod-z for undo', () => {
      extension.onCreate();
      const shortcuts = extension.getKeyboardShortcuts();

      expect(shortcuts).toBeDefined();
      expect(shortcuts['Mod-z']).toBeDefined();
      expect(typeof shortcuts['Mod-z']).toBe('function');
    });

    it('should provide Mod-y for redo', () => {
      extension.onCreate();
      const shortcuts = extension.getKeyboardShortcuts();

      expect(shortcuts).toBeDefined();
      expect(shortcuts['Mod-y']).toBeDefined();
      expect(typeof shortcuts['Mod-y']).toBe('function');
    });

    it('should provide Shift-Mod-z for redo', () => {
      extension.onCreate();
      const shortcuts = extension.getKeyboardShortcuts();

      expect(shortcuts).toBeDefined();
      expect(shortcuts['Shift-Mod-z']).toBeDefined();
      expect(typeof shortcuts['Shift-Mod-z']).toBe('function');
    });
  });

  describe('Commands', () => {
    it('should provide updateUser command', () => {
      extension.onCreate();
      const commands = extension.getCommands();

      expect(commands).toBeDefined();
      expect(commands.updateUser).toBeDefined();
      expect(typeof commands.updateUser).toBe('function');
    });

    it('should provide disconnect command', () => {
      extension.onCreate();
      const commands = extension.getCommands();

      expect(commands).toBeDefined();
      expect(commands.disconnect).toBeDefined();
      expect(typeof commands.disconnect).toBe('function');
    });

    it('should provide reconnect command', () => {
      extension.onCreate();
      const commands = extension.getCommands();

      expect(commands).toBeDefined();
      expect(commands.reconnect).toBeDefined();
      expect(typeof commands.reconnect).toBe('function');
    });

    it('should execute updateUser command', () => {
      // Create extension with custom provider that has awareness
      const mockAwareness = {
        setLocalState: vi.fn(),
        getStates: () => new Map(),
      };
      const mockProvider = {
        awareness: mockAwareness,
      };

      const customExtension = new CollaborationExtension({
        document: ydoc,
        provider: 'custom',
        customProvider: mockProvider,
      });
      customExtension.onCreate();

      const commands = customExtension.getCommands();
      const updateUserCmd = commands.updateUser('Alice', '#ff0000');
      const result = updateUserCmd();

      expect(result).toBe(true);
      expect(mockAwareness.setLocalState).toHaveBeenCalledWith({
        user: {
          name: 'Alice',
          color: '#ff0000',
        },
      });

      customExtension.destroy();
    });

    it('should execute disconnect command', () => {
      const mockProvider = {
        disconnect: vi.fn(),
        awareness: { setLocalState: vi.fn(), getStates: () => new Map() },
      };

      const customExtension = new CollaborationExtension({
        document: ydoc,
        provider: 'custom',
        customProvider: mockProvider,
      });
      customExtension.onCreate();

      const commands = customExtension.getCommands();
      const disconnectCmd = commands.disconnect();
      const result = disconnectCmd();

      expect(result).toBe(true);
      expect(mockProvider.disconnect).toHaveBeenCalled();

      customExtension.destroy();
    });

    it('should execute reconnect command', () => {
      const mockProvider = {
        connect: vi.fn(),
        awareness: { setLocalState: vi.fn(), getStates: () => new Map() },
      };

      const customExtension = new CollaborationExtension({
        document: ydoc,
        provider: 'custom',
        customProvider: mockProvider,
      });
      customExtension.onCreate();

      const commands = customExtension.getCommands();
      const reconnectCmd = commands.reconnect();
      const result = reconnectCmd();

      expect(result).toBe(true);
      expect(mockProvider.connect).toHaveBeenCalled();

      customExtension.destroy();
    });
  });

  describe('Concurrent edits', () => {
    it('should merge concurrent edits from two Y.Docs', () => {
      const doc1 = new Y.Doc();
      const doc2 = new Y.Doc();

      const fragment1 = doc1.getXmlFragment('prosemirror');
      const fragment2 = doc2.getXmlFragment('prosemirror');

      // Create text in doc1
      doc1.transact(() => {
        const text1 = new Y.XmlText();
        text1.insert(0, 'Hello');
        fragment1.insert(0, [text1]);
      });

      // Create text in doc2
      doc2.transact(() => {
        const text2 = new Y.XmlText();
        text2.insert(0, 'World');
        fragment2.insert(0, [text2]);
      });

      // Sync docs
      const update1 = Y.encodeStateAsUpdate(doc1);
      const update2 = Y.encodeStateAsUpdate(doc2);

      Y.applyUpdate(doc2, update1);
      Y.applyUpdate(doc1, update2);

      // Both docs should have merged content
      const merged1 = fragment1.toString();
      const merged2 = fragment2.toString();

      expect(merged1).toBe(merged2);

      doc1.destroy();
      doc2.destroy();
    });

    it('should handle conflicting edits with CRDT', () => {
      const doc1 = new Y.Doc();
      const doc2 = new Y.Doc();

      // Start with same initial state in doc1
      doc1.transact(() => {
        const fragment1 = doc1.getXmlFragment('prosemirror');
        const text = new Y.XmlText();
        text.insert(0, 'Hello');
        fragment1.insert(0, [text]);
      });

      // Sync initial state to doc2
      const update = Y.encodeStateAsUpdate(doc1);
      Y.applyUpdate(doc2, update);

      const fragment1 = doc1.getXmlFragment('prosemirror');
      const fragment2 = doc2.getXmlFragment('prosemirror');

      // Make conflicting edits
      const text1 = fragment1.get(0) as Y.XmlText;
      text1.insert(5, ' World');

      const text2 = fragment2.get(0) as Y.XmlText;
      text2.insert(5, ' Universe');

      // Sync
      const update1 = Y.encodeStateAsUpdate(doc1);
      const update2 = Y.encodeStateAsUpdate(doc2);

      Y.applyUpdate(doc2, update1);
      Y.applyUpdate(doc1, update2);

      // CRDT should resolve conflict
      expect(text1.toString()).toBe(text2.toString());

      doc1.destroy();
      doc2.destroy();
    });

    it('should preserve operation order with CRDT', () => {
      const doc1 = new Y.Doc();
      const doc2 = new Y.Doc();

      // Create initial state in doc1
      doc1.transact(() => {
        const fragment1 = doc1.getXmlFragment('prosemirror');
        const text1 = new Y.XmlText();
        text1.insert(0, 'abc');
        fragment1.insert(0, [text1]);
      });

      // Sync initial state to doc2
      const initialUpdate = Y.encodeStateAsUpdate(doc1);
      Y.applyUpdate(doc2, initialUpdate);

      const fragment1 = doc1.getXmlFragment('prosemirror');
      const fragment2 = doc2.getXmlFragment('prosemirror');
      const text1 = fragment1.get(0) as Y.XmlText;
      const text2 = fragment2.get(0) as Y.XmlText;

      // Make sequential edits
      text1.delete(0, 1); // 'bc'
      text2.insert(3, 'd'); // 'abcd'

      // Sync
      const update1 = Y.encodeStateAsUpdate(doc1);
      const update2 = Y.encodeStateAsUpdate(doc2);

      Y.applyUpdate(doc2, update1);
      Y.applyUpdate(doc1, update2);

      // Both should converge to same state
      expect(text1.toString()).toBe(text2.toString());

      doc1.destroy();
      doc2.destroy();
    });
  });

  describe('Awareness and user presence', () => {
    it('should get users from awareness', () => {
      const mockAwareness = {
        setLocalState: vi.fn(),
        getStates: () => {
          const map = new Map();
          map.set(1, { user: { name: 'Alice', color: '#ff0000' } });
          map.set(2, { user: { name: 'Bob', color: '#00ff00' } });
          return map;
        },
      };

      const mockProvider = {
        awareness: mockAwareness,
      };

      const customExtension = new CollaborationExtension({
        document: ydoc,
        provider: 'custom',
        customProvider: mockProvider,
      });
      customExtension.onCreate();

      const users = customExtension.getUsers();
      expect(users).toHaveLength(2);
      expect(users[0].name).toBe('Alice');
      expect(users[1].name).toBe('Bob');

      customExtension.destroy();
    });

    it('should return empty array when no awareness', () => {
      extension.onCreate();
      const users = extension.getUsers();
      expect(users).toEqual([]);
    });

    it('should include user cursor position', () => {
      const mockAwareness = {
        setLocalState: vi.fn(),
        getStates: () => {
          const map = new Map();
          map.set(1, {
            user: { name: 'Alice', color: '#ff0000' },
            cursor: { anchor: 0, head: 5 },
          });
          return map;
        },
      };

      const mockProvider = {
        awareness: mockAwareness,
      };

      const customExtension = new CollaborationExtension({
        document: ydoc,
        provider: 'custom',
        customProvider: mockProvider,
      });
      customExtension.onCreate();

      const users = customExtension.getUsers();
      expect(users).toHaveLength(1);
      expect(users[0].cursor).toEqual({ anchor: 0, head: 5 });

      customExtension.destroy();
    });
  });

  describe('Provider integration', () => {
    it('should not create provider without providerUrl', () => {
      const noUrlExtension = new CollaborationExtension({
        document: ydoc,
        provider: 'websocket',
      });
      noUrlExtension.onCreate();

      expect(noUrlExtension.getProvider()).toBeUndefined();
      noUrlExtension.destroy();
    });

    it('should not create provider without room', () => {
      const noRoomExtension = new CollaborationExtension({
        document: ydoc,
        provider: 'websocket',
        providerUrl: 'ws://localhost:1234',
      });
      noRoomExtension.onCreate();

      expect(noRoomExtension.getProvider()).toBeUndefined();
      noRoomExtension.destroy();
    });

    it('should accept custom provider', () => {
      const mockProvider = {
        awareness: {
          setLocalState: vi.fn(),
          getStates: () => new Map(),
        },
      };

      const customExtension = new CollaborationExtension({
        document: ydoc,
        provider: 'custom',
        customProvider: mockProvider,
      });
      customExtension.onCreate();

      expect(customExtension.getProvider()).toBe(mockProvider);
      customExtension.destroy();
    });

    it('should destroy provider on extension destroy', () => {
      const mockProvider = {
        destroy: vi.fn(),
        awareness: {
          setLocalState: vi.fn(),
          getStates: () => new Map(),
        },
      };

      const customExtension = new CollaborationExtension({
        document: ydoc,
        provider: 'custom',
        customProvider: mockProvider,
      });
      customExtension.onCreate();
      customExtension.destroy();

      expect(mockProvider.destroy).toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should handle empty document', () => {
      extension.onCreate();
      const fragment = extension.getFragment();
      expect(fragment.length).toBe(0);
    });

    it('should handle multiple onCreate calls', () => {
      extension.onCreate();
      const doc1 = extension.getDocument();

      extension.onCreate();
      const doc2 = extension.getDocument();

      expect(doc1).toBe(doc2);
    });

    it('should handle destroy without onCreate', () => {
      expect(() => extension.destroy()).not.toThrow();
    });

    it('should handle commands without provider', () => {
      extension.onCreate();
      const commands = extension.getCommands();

      expect(commands.updateUser('Test', '#fff')()).toBe(true);
      expect(commands.disconnect()()).toBe(true);
      expect(commands.reconnect()()).toBe(true);
    });
  });

  describe('Extension lifecycle', () => {
    it('should configure with options', () => {
      const options = { username: 'Charlie' };
      extension.configure(options);
      expect(extension.getOptions()).toMatchObject(options);
    });

    it('should handle editor instance', () => {
      const mockEditor = {} as any;
      extension.setEditor(mockEditor);
      extension.onCreate();
      expect(() => extension.destroy()).not.toThrow();
    });

    it('should clean up on destroy', () => {
      extension.onCreate();
      const doc = extension.getDocument();

      extension.destroy();

      // Extension should still be usable after destroy
      expect(extension.name).toBe('collaboration');
    });
  });
});
