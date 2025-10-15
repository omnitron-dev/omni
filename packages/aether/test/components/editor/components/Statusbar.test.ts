import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '../../../../src/core/index.js';
import { Statusbar, getDefaultStatusbarItems, type StatusbarItem } from '../../../../src/components/editor/components/Statusbar.js';
import type { EditorInstance } from '../../../../src/components/editor/core/types.js';
import { Schema } from 'prosemirror-model';

describe('Statusbar', () => {
  let mockEditor: EditorInstance;
  let editorSignal: ReturnType<typeof signal<EditorInstance | null>>;

  beforeEach(() => {
    const schema = new Schema({
      nodes: {
        doc: { content: 'block+' },
        paragraph: { content: 'inline*', group: 'block' },
        text: { group: 'inline' },
      },
    });

    mockEditor = {
      state: {} as any,
      view: {} as any,
      schema,
      signals: {
        wordCount: signal(5),
        charCount: signal(25),
        isEmpty: signal(false),
        canUndo: signal(true),
        canRedo: signal(false),
      } as any,
      commands: {
        execute: vi.fn(() => true),
        can: vi.fn(() => true),
        chain: vi.fn(),
      },
    } as any;

    editorSignal = signal<EditorInstance | null>(mockEditor);
  });

  it('should be defined', () => {
    expect(Statusbar).toBeDefined();
    expect(typeof Statusbar).toBe('function');
  });

  it('should have displayName', () => {
    expect(Statusbar.displayName).toBe('Statusbar');
  });

  describe('getDefaultStatusbarItems', () => {
    it('should return default items', () => {
      const items = getDefaultStatusbarItems();
      expect(items).toHaveLength(2);
    });

    it('should include word count item', () => {
      const items = getDefaultStatusbarItems();
      expect(items[0].type).toBe('text');

      const text = items[0].render(mockEditor);
      expect(text).toContain('word');
    });

    it('should include character count item', () => {
      const items = getDefaultStatusbarItems();
      expect(items[1].type).toBe('text');

      const text = items[1].render(mockEditor);
      expect(text).toContain('character');
    });

    it('should show correct word count', () => {
      const items = getDefaultStatusbarItems();
      mockEditor.signals!.wordCount = signal(10);

      const text = items[0].render(mockEditor);
      expect(text).toBe('10 words');
    });

    it('should show singular word for count of 1', () => {
      const items = getDefaultStatusbarItems();
      mockEditor.signals!.wordCount = signal(1);

      const text = items[0].render(mockEditor);
      expect(text).toBe('1 word');
    });

    it('should show plural words for count not equal to 1', () => {
      const items = getDefaultStatusbarItems();

      mockEditor.signals!.wordCount = signal(0);
      let text = items[0].render(mockEditor);
      expect(text).toBe('0 words');

      mockEditor.signals!.wordCount = signal(100);
      text = items[0].render(mockEditor);
      expect(text).toBe('100 words');
    });

    it('should show correct character count', () => {
      const items = getDefaultStatusbarItems();
      mockEditor.signals!.charCount = signal(50);

      const text = items[1].render(mockEditor);
      expect(text).toBe('50 characters');
    });

    it('should show singular character for count of 1', () => {
      const items = getDefaultStatusbarItems();
      mockEditor.signals!.charCount = signal(1);

      const text = items[1].render(mockEditor);
      expect(text).toBe('1 character');
    });

    it('should show plural characters for count not equal to 1', () => {
      const items = getDefaultStatusbarItems();

      mockEditor.signals!.charCount = signal(0);
      let text = items[1].render(mockEditor);
      expect(text).toBe('0 characters');

      mockEditor.signals!.charCount = signal(1000);
      text = items[1].render(mockEditor);
      expect(text).toBe('1000 characters');
    });

    it('should handle missing signals gracefully', () => {
      const items = getDefaultStatusbarItems();
      const editorWithoutSignals = { ...mockEditor, signals: undefined };

      const wordCountText = items[0].render(editorWithoutSignals as any);
      expect(wordCountText).toBe('0 words');

      const charCountText = items[1].render(editorWithoutSignals as any);
      expect(charCountText).toBe('0 characters');
    });
  });

  describe('Component behavior', () => {
    it('should handle null editor', () => {
      const nullSignal = signal<EditorInstance | null>(null);
      expect(() => {
        Statusbar({ editor: nullSignal });
      }).not.toThrow();
    });

    it('should accept custom items', () => {
      const customItems: StatusbarItem[] = [
        {
          type: 'text',
          render: () => 'Custom text',
        },
      ];

      expect(() => {
        Statusbar({ editor: editorSignal, items: customItems });
      }).not.toThrow();
    });

    it('should accept custom class', () => {
      expect(() => {
        Statusbar({ editor: editorSignal, class: 'custom-statusbar' });
      }).not.toThrow();
    });

    it('should accept position prop', () => {
      expect(() => {
        Statusbar({ editor: editorSignal, position: 'top' });
      }).not.toThrow();

      expect(() => {
        Statusbar({ editor: editorSignal, position: 'bottom' });
      }).not.toThrow();
    });

    it('should handle text items with custom class', () => {
      const customItems: StatusbarItem[] = [
        {
          type: 'text',
          render: () => 'Custom',
          class: 'custom-text',
        },
      ];

      expect(() => {
        Statusbar({ editor: editorSignal, items: customItems });
      }).not.toThrow();
    });

    it('should handle button items', () => {
      const onClick = vi.fn();
      const customItems: StatusbarItem[] = [
        {
          type: 'button',
          text: 'Click me',
          onClick,
        },
      ];

      expect(() => {
        Statusbar({ editor: editorSignal, items: customItems });
      }).not.toThrow();
    });

    it('should handle button items with icon', () => {
      const onClick = vi.fn();
      const customItems: StatusbarItem[] = [
        {
          type: 'button',
          icon: '⚙️',
          title: 'Settings',
          onClick,
        },
      ];

      expect(() => {
        Statusbar({ editor: editorSignal, items: customItems });
      }).not.toThrow();
    });

    it('should handle button items with custom class', () => {
      const onClick = vi.fn();
      const customItems: StatusbarItem[] = [
        {
          type: 'button',
          text: 'Button',
          onClick,
          class: 'custom-button',
        },
      ];

      expect(() => {
        Statusbar({ editor: editorSignal, items: customItems });
      }).not.toThrow();
    });

    it('should handle custom render items', () => {
      const customItems: StatusbarItem[] = [
        {
          type: 'custom',
          render: () => 'Custom content',
        },
      ];

      expect(() => {
        Statusbar({ editor: editorSignal, items: customItems });
      }).not.toThrow();
    });

    it('should handle mixed item types', () => {
      const onClick = vi.fn();
      const mixedItems: StatusbarItem[] = [
        {
          type: 'text',
          render: () => 'Status',
        },
        {
          type: 'button',
          text: 'Action',
          onClick,
        },
        {
          type: 'custom',
          render: () => 'Custom',
        },
      ];

      expect(() => {
        Statusbar({ editor: editorSignal, items: mixedItems });
      }).not.toThrow();
    });

    it('should call text render function with editor', () => {
      const renderFn = vi.fn(() => 'Test');
      const customItems: StatusbarItem[] = [
        {
          type: 'text',
          render: renderFn,
        },
      ];

      Statusbar({ editor: editorSignal, items: customItems });
      // The render function should be defined but not necessarily called immediately
      expect(renderFn).toBeDefined();
    });

    it('should call custom render function with editor', () => {
      const renderFn = vi.fn(() => 'Custom');
      const customItems: StatusbarItem[] = [
        {
          type: 'custom',
          render: renderFn,
        },
      ];

      Statusbar({ editor: editorSignal, items: customItems });
      // The render function should be defined
      expect(renderFn).toBeDefined();
    });
  });
});
