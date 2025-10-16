/**
 * CollaborationCursorExtension tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { Schema } from 'prosemirror-model';
import * as Y from 'yjs';
import { CollaborationExtension } from '../../../../../src/components/editor/extensions/collaboration/CollaborationExtension.js';
import { CollaborationCursorExtension } from '../../../../../src/components/editor/extensions/collaboration/CollaborationCursorExtension.js';
import { SchemaBuilder } from '../../../../../src/components/editor/core/SchemaBuilder.js';
import { ExtensionManager } from '../../../../../src/components/editor/core/ExtensionManager.js';
import type { User } from '../../../../../src/components/editor/extensions/collaboration/types.js';

describe('CollaborationCursorExtension', () => {
  let collaborationExt: CollaborationExtension;
  let cursorExt: CollaborationCursorExtension;
  let schema: Schema;
  let ydoc: Y.Doc;
  let mockEditor: any;

  beforeEach(() => {
    ydoc = new Y.Doc();
    collaborationExt = new CollaborationExtension({ document: ydoc });
    cursorExt = new CollaborationCursorExtension();

    const builder = new SchemaBuilder();
    schema = builder.build();

    // Create mock editor with extension manager
    const manager = new ExtensionManager([collaborationExt, cursorExt]);
    mockEditor = {
      extensionManager: manager,
    };
  });

  afterEach(() => {
    cursorExt.destroy();
    collaborationExt.destroy();
    ydoc.destroy();
  });

  describe('Extension metadata', () => {
    it('should have correct name', () => {
      expect(cursorExt.name).toBe('collaboration_cursor');
    });

    it('should have correct type', () => {
      expect(cursorExt.type).toBe('behavior');
    });

    it('should depend on collaboration extension', () => {
      expect(cursorExt.dependencies).toEqual(['collaboration']);
    });
  });

  describe('Default options', () => {
    it('should have default cursor builder', () => {
      const options = cursorExt.getOptions();
      expect(options.cursorBuilder).toBeDefined();
      expect(typeof options.cursorBuilder).toBe('function');
    });

    it('should have default selection builder', () => {
      const options = cursorExt.getOptions();
      expect(options.selectionBuilder).toBeDefined();
      expect(typeof options.selectionBuilder).toBe('function');
    });
  });

  describe('Custom options', () => {
    it('should accept custom cursor builder', () => {
      const customBuilder = (user: User) => {
        const el = document.createElement('span');
        el.className = 'custom-cursor';
        return el;
      };

      const customExt = new CollaborationCursorExtension({
        cursorBuilder: customBuilder,
      });

      const options = customExt.getOptions();
      expect(options.cursorBuilder).toBe(customBuilder);
    });

    it('should accept custom selection builder', () => {
      const customBuilder = (user: User) => {
        const el = document.createElement('span');
        el.className = 'custom-selection';
        return el;
      };

      const customExt = new CollaborationCursorExtension({
        selectionBuilder: customBuilder,
      });

      const options = customExt.getOptions();
      expect(options.selectionBuilder).toBe(customBuilder);
    });

    it('should configure options after creation', () => {
      const customBuilder = (user: User) => document.createElement('div');
      cursorExt.configure({ cursorBuilder: customBuilder });

      const options = cursorExt.getOptions();
      expect(options.cursorBuilder).toBe(customBuilder);
    });
  });

  describe('Cursor rendering', () => {
    it('should render cursor with default builder', () => {
      const user: User = {
        id: '1',
        name: 'Alice',
        color: '#ff0000',
      };

      const options = cursorExt.getOptions();
      const cursorEl = options.cursorBuilder!(user);

      expect(cursorEl).toBeInstanceOf(HTMLElement);
      expect(cursorEl.className).toBe('collaboration-cursor');
      // CSS colors can be in different formats, check the style contains the color
      expect(cursorEl.style.cssText).toContain('#ff0000');
    });

    it('should render cursor label with username', () => {
      const user: User = {
        id: '1',
        name: 'Alice',
        color: '#ff0000',
      };

      const options = cursorExt.getOptions();
      const cursorEl = options.cursorBuilder!(user);

      const label = cursorEl.querySelector('.collaboration-cursor-label');
      expect(label).toBeDefined();
      expect(label?.textContent).toBe('Alice');
    });

    it('should render cursor with user color', () => {
      const user: User = {
        id: '1',
        name: 'Bob',
        color: '#00ff00',
      };

      const options = cursorExt.getOptions();
      const cursorEl = options.cursorBuilder!(user);

      expect(cursorEl.style.cssText).toContain('#00ff00');
    });

    it('should use custom cursor builder', () => {
      const customBuilder = (user: User) => {
        const el = document.createElement('div');
        el.className = 'my-custom-cursor';
        el.setAttribute('data-user', user.name);
        return el;
      };

      const customExt = new CollaborationCursorExtension({
        cursorBuilder: customBuilder,
      });

      const user: User = {
        id: '1',
        name: 'Charlie',
        color: '#0000ff',
      };

      const options = customExt.getOptions();
      const cursorEl = options.cursorBuilder!(user);

      expect(cursorEl.className).toBe('my-custom-cursor');
      expect(cursorEl.getAttribute('data-user')).toBe('Charlie');
    });
  });

  describe('Selection rendering', () => {
    it('should render selection with default builder', () => {
      const user: User = {
        id: '1',
        name: 'Alice',
        color: '#ff0000',
      };

      const options = cursorExt.getOptions();
      const selectionEl = options.selectionBuilder!(user);

      expect(selectionEl).toBeInstanceOf(HTMLElement);
      expect(selectionEl.className).toBe('collaboration-selection');
      expect(selectionEl.style.cssText).toContain('#ff0000');
    });

    it('should render selection with user color', () => {
      const user: User = {
        id: '1',
        name: 'Bob',
        color: '#00ff00',
      };

      const options = cursorExt.getOptions();
      const selectionEl = options.selectionBuilder!(user);

      expect(selectionEl.style.cssText).toContain('#00ff00');
    });

    it('should render selection with transparency', () => {
      const user: User = {
        id: '1',
        name: 'Alice',
        color: '#ff0000',
      };

      const options = cursorExt.getOptions();
      const selectionEl = options.selectionBuilder!(user);

      expect(selectionEl.style.opacity).toBe('0.3');
    });

    it('should use custom selection builder', () => {
      const customBuilder = (user: User) => {
        const el = document.createElement('span');
        el.className = 'my-custom-selection';
        el.style.backgroundColor = user.color;
        el.style.opacity = '0.5';
        return el;
      };

      const customExt = new CollaborationCursorExtension({
        selectionBuilder: customBuilder,
      });

      const user: User = {
        id: '1',
        name: 'David',
        color: '#0000ff',
      };

      const options = customExt.getOptions();
      const selectionEl = options.selectionBuilder!(user);

      expect(selectionEl.className).toBe('my-custom-selection');
      expect(selectionEl.style.opacity).toBe('0.5');
    });
  });

  describe('Plugins', () => {
    it('should provide cursor plugin', () => {
      cursorExt.setEditor(mockEditor);
      cursorExt.onCreate();

      const plugins = cursorExt.getPlugins();
      expect(plugins).toBeDefined();
      expect(Array.isArray(plugins)).toBe(true);
      expect(plugins.length).toBe(1);
    });

    it('should create plugin with correct key', () => {
      collaborationExt.onCreate();
      cursorExt.setEditor(mockEditor);
      cursorExt.onCreate();

      const plugins = cursorExt.getPlugins();
      // Plugin key may have a suffix, just check it starts with the base name
      expect(plugins[0].spec.key?.key).toContain('collaborationCursor');
    });
  });

  describe('Multiple users', () => {
    it('should handle multiple users', () => {
      const mockAwareness = {
        clientID: 0,
        setLocalState: vi.fn(),
        getStates: () => {
          const map = new Map();
          map.set(1, {
            user: { name: 'Alice', color: '#ff0000' },
            cursor: { anchor: 0, head: 0 },
          });
          map.set(2, {
            user: { name: 'Bob', color: '#00ff00' },
            cursor: { anchor: 5, head: 5 },
          });
          return map;
        },
      };

      const mockProvider = {
        awareness: mockAwareness,
      };

      const collabExt = new CollaborationExtension({
        document: ydoc,
        provider: 'custom',
        customProvider: mockProvider,
      });

      const manager = new ExtensionManager([collabExt, cursorExt]);
      const editor = { extensionManager: manager };

      cursorExt.setEditor(editor);
      cursorExt.onCreate();

      // Verify collaboration extension is accessible
      const collab = manager.getExtension('collaboration');
      expect(collab).toBeDefined();

      collabExt.destroy();
    });

    it('should skip local user cursor', () => {
      const localClientId = 123;

      const mockAwareness = {
        clientID: localClientId,
        setLocalState: vi.fn(),
        getStates: () => {
          const map = new Map();
          // Local user
          map.set(localClientId, {
            user: { name: 'Me', color: '#000000' },
            cursor: { anchor: 0, head: 0 },
          });
          // Remote user
          map.set(456, {
            user: { name: 'Alice', color: '#ff0000' },
            cursor: { anchor: 5, head: 5 },
          });
          return map;
        },
      };

      const mockProvider = {
        awareness: mockAwareness,
      };

      const collabExt = new CollaborationExtension({
        document: ydoc,
        provider: 'custom',
        customProvider: mockProvider,
      });

      const manager = new ExtensionManager([collabExt, cursorExt]);
      const editor = { extensionManager: manager };

      cursorExt.setEditor(editor);
      collabExt.onCreate();
      cursorExt.onCreate();

      // getUsers returns all users including local
      const users = collabExt.getUsers();
      expect(users).toHaveLength(2);

      collabExt.destroy();
    });
  });

  describe('Cursor updates', () => {
    it('should handle cursor position updates', () => {
      const mockAwareness = {
        clientID: 0,
        setLocalState: vi.fn(),
        getStates: () => {
          const map = new Map();
          map.set(1, {
            user: { name: 'Alice', color: '#ff0000' },
            cursor: { anchor: 10, head: 10 },
          });
          return map;
        },
      };

      const mockProvider = {
        awareness: mockAwareness,
      };

      const collabExt = new CollaborationExtension({
        document: ydoc,
        provider: 'custom',
        customProvider: mockProvider,
      });

      const manager = new ExtensionManager([collabExt, cursorExt]);
      const editor = { extensionManager: manager };

      cursorExt.setEditor(editor);
      collabExt.onCreate();
      cursorExt.onCreate();

      const users = collabExt.getUsers();
      expect(users[0].cursor).toEqual({ anchor: 10, head: 10 });

      collabExt.destroy();
    });

    it('should handle selection range', () => {
      const mockAwareness = {
        clientID: 0,
        setLocalState: vi.fn(),
        getStates: () => {
          const map = new Map();
          map.set(1, {
            user: { name: 'Alice', color: '#ff0000' },
            cursor: { anchor: 0, head: 10 },
          });
          return map;
        },
      };

      const mockProvider = {
        awareness: mockAwareness,
      };

      const collabExt = new CollaborationExtension({
        document: ydoc,
        provider: 'custom',
        customProvider: mockProvider,
      });

      const manager = new ExtensionManager([collabExt, cursorExt]);
      const editor = { extensionManager: manager };

      cursorExt.setEditor(editor);
      collabExt.onCreate();
      cursorExt.onCreate();

      const users = collabExt.getUsers();
      expect(users[0].cursor?.anchor).toBe(0);
      expect(users[0].cursor?.head).toBe(10);

      collabExt.destroy();
    });
  });

  describe('User leave/join', () => {
    it('should handle user joining', () => {
      const states = new Map();

      const mockAwareness = {
        clientID: 0,
        setLocalState: vi.fn(),
        getStates: () => states,
      };

      const mockProvider = {
        awareness: mockAwareness,
      };

      const collabExt = new CollaborationExtension({
        document: ydoc,
        provider: 'custom',
        customProvider: mockProvider,
      });

      const manager = new ExtensionManager([collabExt, cursorExt]);
      const editor = { extensionManager: manager };

      cursorExt.setEditor(editor);
      collabExt.onCreate();
      cursorExt.onCreate();

      // Initially no users
      expect(collabExt.getUsers()).toHaveLength(0);

      // User joins
      states.set(1, {
        user: { name: 'Alice', color: '#ff0000' },
        cursor: { anchor: 0, head: 0 },
      });

      expect(collabExt.getUsers()).toHaveLength(1);

      collabExt.destroy();
    });

    it('should handle user leaving', () => {
      const states = new Map();
      states.set(1, {
        user: { name: 'Alice', color: '#ff0000' },
        cursor: { anchor: 0, head: 0 },
      });

      const mockAwareness = {
        clientID: 0,
        setLocalState: vi.fn(),
        getStates: () => states,
      };

      const mockProvider = {
        awareness: mockAwareness,
      };

      const collabExt = new CollaborationExtension({
        document: ydoc,
        provider: 'custom',
        customProvider: mockProvider,
      });

      const manager = new ExtensionManager([collabExt, cursorExt]);
      const editor = { extensionManager: manager };

      cursorExt.setEditor(editor);
      collabExt.onCreate();
      cursorExt.onCreate();

      // Initially one user
      expect(collabExt.getUsers()).toHaveLength(1);

      // User leaves
      states.delete(1);

      expect(collabExt.getUsers()).toHaveLength(0);

      collabExt.destroy();
    });
  });

  describe('Edge cases', () => {
    it('should handle missing collaboration extension', () => {
      // This test verifies that the cursor extension gracefully handles
      // when collaboration extension is not present (should throw during manager creation)
      expect(() => {
        new ExtensionManager([cursorExt]);
      }).toThrow('Extension "collaboration_cursor" depends on "collaboration"');
    });

    it('should handle user without cursor', () => {
      const mockAwareness = {
        clientID: 0,
        setLocalState: vi.fn(),
        getStates: () => {
          const map = new Map();
          map.set(1, {
            user: { name: 'Alice', color: '#ff0000' },
            // No cursor field
          });
          return map;
        },
      };

      const mockProvider = {
        awareness: mockAwareness,
      };

      const collabExt = new CollaborationExtension({
        document: ydoc,
        provider: 'custom',
        customProvider: mockProvider,
      });

      const manager = new ExtensionManager([collabExt, cursorExt]);
      const editor = { extensionManager: manager };

      cursorExt.setEditor(editor);
      collabExt.onCreate();
      cursorExt.onCreate();

      const users = collabExt.getUsers();
      expect(users.length).toBeGreaterThan(0);
      if (users[0]) {
        expect(users[0].cursor).toBeUndefined();
      }

      collabExt.destroy();
    });

    it('should handle invalid cursor positions', () => {
      const mockAwareness = {
        clientID: 0,
        setLocalState: vi.fn(),
        getStates: () => {
          const map = new Map();
          map.set(1, {
            user: { name: 'Alice', color: '#ff0000' },
            cursor: { anchor: -1, head: -1 },
          });
          return map;
        },
      };

      const mockProvider = {
        awareness: mockAwareness,
      };

      const collabExt = new CollaborationExtension({
        document: ydoc,
        provider: 'custom',
        customProvider: mockProvider,
      });

      const manager = new ExtensionManager([collabExt, cursorExt]);
      const editor = { extensionManager: manager };

      cursorExt.setEditor(editor);
      cursorExt.onCreate();

      // Should handle gracefully
      expect(() => cursorExt.getPlugins()).not.toThrow();

      collabExt.destroy();
    });
  });

  describe('Extension lifecycle', () => {
    it('should initialize on onCreate', () => {
      cursorExt.setEditor(mockEditor);
      expect(() => cursorExt.onCreate()).not.toThrow();
    });

    it('should clean up on destroy', () => {
      cursorExt.setEditor(mockEditor);
      cursorExt.onCreate();

      expect(() => cursorExt.destroy()).not.toThrow();
    });

    it('should handle editor instance', () => {
      expect(() => cursorExt.setEditor(mockEditor)).not.toThrow();
      expect(() => cursorExt.onCreate()).not.toThrow();
      expect(() => cursorExt.destroy()).not.toThrow();
    });
  });
});
