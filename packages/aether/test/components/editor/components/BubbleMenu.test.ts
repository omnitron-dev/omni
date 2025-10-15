import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '../../../../src/core/index.js';
import { BubbleMenu, getDefaultBubbleMenuItems, type BubbleMenuItem } from '../../../../src/components/editor/components/BubbleMenu.js';
import type { EditorInstance } from '../../../../src/components/editor/core/types.js';
import { Schema } from 'prosemirror-model';

describe('BubbleMenu', () => {
  let mockEditor: EditorInstance;
  let editorSignal: ReturnType<typeof signal<EditorInstance | null>>;

  beforeEach(() => {
    const schema = new Schema({
      nodes: {
        doc: { content: 'block+' },
        paragraph: { content: 'inline*', group: 'block' },
        text: { group: 'inline' },
      },
      marks: {
        bold: {},
        italic: {},
      },
    });

    mockEditor = {
      state: {
        selection: {
          empty: false,
          from: 0,
          to: 5,
        } as any,
      } as any,
      view: {
        state: {
          selection: {
            empty: false,
            from: 0,
            to: 5,
          } as any,
        },
        coordsAtPos: vi.fn((pos: number) => ({
          left: 100 + pos * 10,
          top: 200,
          right: 120 + pos * 10,
          bottom: 220,
        })),
        dispatch: vi.fn(),
      } as any,
      schema,
      signals: {
        wordCount: signal(5),
        charCount: signal(25),
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
    expect(BubbleMenu).toBeDefined();
    expect(typeof BubbleMenu).toBe('function');
  });

  it('should have displayName', () => {
    expect(BubbleMenu.displayName).toBe('BubbleMenu');
  });

  describe('getDefaultBubbleMenuItems', () => {
    it('should return default items', () => {
      const items = getDefaultBubbleMenuItems();
      expect(items).toHaveLength(5);
    });

    it('should include Bold button', () => {
      const items = getDefaultBubbleMenuItems();
      const boldItem = items.find(
        (item) => item.type === 'button' && item.command === 'bold',
      ) as BubbleMenuItem & { type: 'button' };
      expect(boldItem).toBeDefined();
      expect(boldItem.icon).toBe('B');
      expect(boldItem.title).toBe('Bold');
    });

    it('should include Italic button', () => {
      const items = getDefaultBubbleMenuItems();
      const italicItem = items.find(
        (item) => item.type === 'button' && item.command === 'italic',
      ) as BubbleMenuItem & { type: 'button' };
      expect(italicItem).toBeDefined();
      expect(italicItem.icon).toBe('I');
      expect(italicItem.title).toBe('Italic');
    });

    it('should include Underline button', () => {
      const items = getDefaultBubbleMenuItems();
      const underlineItem = items.find(
        (item) => item.type === 'button' && item.command === 'underline',
      ) as BubbleMenuItem & { type: 'button' };
      expect(underlineItem).toBeDefined();
      expect(underlineItem.icon).toBe('U');
      expect(underlineItem.title).toBe('Underline');
    });

    it('should include Link button', () => {
      const items = getDefaultBubbleMenuItems();
      const linkItem = items.find(
        (item) => item.type === 'button' && item.command === 'setLink',
      ) as BubbleMenuItem & { type: 'button' };
      expect(linkItem).toBeDefined();
      expect(linkItem.icon).toBe('🔗');
      expect(linkItem.title).toBe('Link');
    });

    it('should include a divider', () => {
      const items = getDefaultBubbleMenuItems();
      const divider = items.find((item) => item.type === 'divider');
      expect(divider).toBeDefined();
    });

    it('should have correct item order', () => {
      const items = getDefaultBubbleMenuItems();
      expect(items[0].type).toBe('button');
      expect(items[1].type).toBe('button');
      expect(items[2].type).toBe('button');
      expect(items[3].type).toBe('divider');
      expect(items[4].type).toBe('button');
    });
  });

  describe('Component behavior', () => {
    it('should handle null editor', () => {
      const nullSignal = signal<EditorInstance | null>(null);
      expect(() => {
        BubbleMenu({ editor: nullSignal });
      }).not.toThrow();
    });

    it('should accept custom items', () => {
      const customItems: BubbleMenuItem[] = [
        {
          type: 'button',
          icon: 'X',
          title: 'Custom',
          command: 'custom',
        },
      ];

      expect(() => {
        BubbleMenu({ editor: editorSignal, items: customItems });
      }).not.toThrow();
    });

    it('should accept custom class', () => {
      expect(() => {
        BubbleMenu({ editor: editorSignal, class: 'custom-bubble' });
      }).not.toThrow();
    });

    it('should accept shouldShow callback', () => {
      const shouldShow = vi.fn(() => false);
      expect(() => {
        BubbleMenu({ editor: editorSignal, shouldShow });
      }).not.toThrow();
    });

    it('should accept offset option', () => {
      expect(() => {
        BubbleMenu({ editor: editorSignal, offset: { x: 10, y: -20 } });
      }).not.toThrow();
    });

    it('should handle editor with empty selection', () => {
      const editorWithEmptySelection = {
        ...mockEditor,
        state: {
          selection: {
            empty: true,
          } as any,
        },
        view: {
          ...mockEditor.view,
          state: {
            selection: {
              empty: true,
            } as any,
          },
        },
      };

      const sig = signal<EditorInstance | null>(editorWithEmptySelection as any);
      expect(() => {
        BubbleMenu({ editor: sig });
      }).not.toThrow();
    });

    it('should handle custom items with isActive callback', () => {
      const customItems: BubbleMenuItem[] = [
        {
          type: 'button',
          icon: 'B',
          title: 'Bold',
          command: 'bold',
          isActive: (editor) => true,
        },
      ];

      expect(() => {
        BubbleMenu({ editor: editorSignal, items: customItems });
      }).not.toThrow();
    });

    it('should handle custom items with isDisabled callback', () => {
      const customItems: BubbleMenuItem[] = [
        {
          type: 'button',
          icon: 'B',
          title: 'Bold',
          command: 'bold',
          isDisabled: (editor) => true,
        },
      ];

      expect(() => {
        BubbleMenu({ editor: editorSignal, items: customItems });
      }).not.toThrow();
    });

    it('should handle items with command args', () => {
      const customItems: BubbleMenuItem[] = [
        {
          type: 'button',
          icon: 'H',
          title: 'Heading',
          command: 'setHeading',
          args: [1],
        },
      ];

      expect(() => {
        BubbleMenu({ editor: editorSignal, items: customItems });
      }).not.toThrow();
    });

    it('should handle divider items', () => {
      const customItems: BubbleMenuItem[] = [
        {
          type: 'button',
          icon: 'A',
          title: 'Action A',
          command: 'a',
        },
        {
          type: 'divider',
        },
        {
          type: 'button',
          icon: 'B',
          title: 'Action B',
          command: 'b',
        },
      ];

      expect(() => {
        BubbleMenu({ editor: editorSignal, items: customItems });
      }).not.toThrow();
    });

    it('should handle editor without commands', () => {
      const editorWithoutCommands = { ...mockEditor, commands: undefined };
      const sig = signal<EditorInstance | null>(editorWithoutCommands as any);

      expect(() => {
        BubbleMenu({ editor: sig });
      }).not.toThrow();
    });

    it('should handle editor without view', () => {
      const editorWithoutView = { ...mockEditor, view: undefined };
      const sig = signal<EditorInstance | null>(editorWithoutView as any);

      expect(() => {
        BubbleMenu({ editor: sig });
      }).not.toThrow();
    });
  });
});
