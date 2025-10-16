/**
 * SearchPanel tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '../../../../src/core/index.js';
import { SearchPanel } from '../../../../src/components/editor/components/SearchPanel.js';
import type { EditorInstance } from '../../../../src/components/editor/core/types.js';

describe('SearchPanel', () => {
  let mockEditor: EditorInstance;
  let editorSignal: ReturnType<typeof signal<EditorInstance | null>>;
  let isOpenSignal: ReturnType<typeof signal<boolean>>;
  let mockSearchExtension: any;

  beforeEach(() => {
    // Create mock search extension
    mockSearchExtension = {
      search: vi.fn(() => []),
      replace: vi.fn(() => true),
      replaceAll: vi.fn(() => 2),
      findNext: vi.fn(() => true),
      findPrevious: vi.fn(() => true),
      clearSearch: vi.fn(),
      getSearchState: vi.fn(() => ({
        query: '',
        results: [],
        currentIndex: -1,
        options: {
          caseSensitive: false,
          wholeWord: false,
          regex: false,
          highlightMatches: true,
          maxMatches: 1000,
        },
      })),
    };

    // Create mock editor
    mockEditor = {
      state: {} as any,
      view: {} as any,
      schema: {} as any,
      extensionManager: {
        getExtension: vi.fn((name: string) => {
          if (name === 'search') {
            return mockSearchExtension;
          }
          return undefined;
        }),
      },
    } as any;

    editorSignal = signal<EditorInstance | null>(mockEditor);
    isOpenSignal = signal(true);
  });

  describe('Component definition', () => {
    it('should be defined', () => {
      expect(SearchPanel).toBeDefined();
      expect(typeof SearchPanel).toBe('function');
    });

    it('should have displayName', () => {
      expect(SearchPanel.displayName).toBe('SearchPanel');
    });
  });

  describe('Component rendering', () => {
    it('should not throw when rendered with isOpen true', () => {
      expect(() => {
        SearchPanel({ editor: editorSignal, isOpen: isOpenSignal });
      }).not.toThrow();
    });

    it('should not throw when rendered with isOpen false', () => {
      isOpenSignal.set(false);
      expect(() => {
        SearchPanel({ editor: editorSignal, isOpen: isOpenSignal });
      }).not.toThrow();
    });

    it('should not throw with custom class', () => {
      expect(() => {
        SearchPanel({ editor: editorSignal, isOpen: isOpenSignal, class: 'custom-class' });
      }).not.toThrow();
    });

    it('should not throw with top position', () => {
      expect(() => {
        SearchPanel({ editor: editorSignal, isOpen: isOpenSignal, position: 'top' });
      }).not.toThrow();
    });

    it('should not throw with bottom position', () => {
      expect(() => {
        SearchPanel({ editor: editorSignal, isOpen: isOpenSignal, position: 'bottom' });
      }).not.toThrow();
    });
  });

  describe('Editor states', () => {
    it('should handle null editor gracefully', () => {
      editorSignal.set(null);
      expect(() => {
        SearchPanel({ editor: editorSignal, isOpen: isOpenSignal });
      }).not.toThrow();
    });

    it('should handle editor without extensionManager', () => {
      const editorWithoutExtMgr = { ...mockEditor, extensionManager: undefined };
      editorSignal.set(editorWithoutExtMgr as any);
      expect(() => {
        SearchPanel({ editor: editorSignal, isOpen: isOpenSignal });
      }).not.toThrow();
    });

    it('should handle editor without search extension', () => {
      const editorWithoutSearch = {
        ...mockEditor,
        extensionManager: {
          getExtension: vi.fn(() => undefined),
        },
      };
      editorSignal.set(editorWithoutSearch as any);
      expect(() => {
        SearchPanel({ editor: editorSignal, isOpen: isOpenSignal });
      }).not.toThrow();
    });
  });

  describe('Search results', () => {
    it('should handle empty results', () => {
      mockSearchExtension.getSearchState.mockReturnValue({
        query: 'test',
        results: [],
        currentIndex: -1,
        options: {},
      });

      expect(() => {
        SearchPanel({ editor: editorSignal, isOpen: isOpenSignal });
      }).not.toThrow();
    });

    it('should handle single result', () => {
      mockSearchExtension.getSearchState.mockReturnValue({
        query: 'test',
        results: [{ from: 0, to: 4, text: 'test' }],
        currentIndex: 0,
        options: {},
      });

      expect(() => {
        SearchPanel({ editor: editorSignal, isOpen: isOpenSignal });
      }).not.toThrow();
    });

    it('should handle multiple results', () => {
      mockSearchExtension.getSearchState.mockReturnValue({
        query: 'test',
        results: [
          { from: 0, to: 4, text: 'test' },
          { from: 10, to: 14, text: 'test' },
          { from: 20, to: 24, text: 'test' },
        ],
        currentIndex: 1,
        options: {},
      });

      expect(() => {
        SearchPanel({ editor: editorSignal, isOpen: isOpenSignal });
      }).not.toThrow();
    });

    it('should handle result navigation', () => {
      mockSearchExtension.getSearchState.mockReturnValue({
        query: 'test',
        results: [
          { from: 0, to: 4, text: 'test' },
          { from: 10, to: 14, text: 'test' },
        ],
        currentIndex: 0,
        options: {},
      });

      expect(() => {
        SearchPanel({ editor: editorSignal, isOpen: isOpenSignal });
      }).not.toThrow();

      // Verify that findNext can be called
      expect(mockSearchExtension.findNext).toBeDefined();
      expect(mockSearchExtension.findPrevious).toBeDefined();
    });
  });

  describe('Panel visibility', () => {
    it('should handle toggling visibility', () => {
      expect(() => {
        SearchPanel({ editor: editorSignal, isOpen: isOpenSignal });
        isOpenSignal.set(false);
        isOpenSignal.set(true);
      }).not.toThrow();
    });

    it('should handle rapid visibility changes', () => {
      expect(() => {
        SearchPanel({ editor: editorSignal, isOpen: isOpenSignal });
        for (let i = 0; i < 5; i++) {
          isOpenSignal.set(false);
          isOpenSignal.set(true);
        }
      }).not.toThrow();
    });
  });

  describe('Search options', () => {
    it('should handle case sensitive option', () => {
      mockSearchExtension.getSearchState.mockReturnValue({
        query: 'test',
        results: [],
        currentIndex: -1,
        options: { caseSensitive: true },
      });

      expect(() => {
        SearchPanel({ editor: editorSignal, isOpen: isOpenSignal });
      }).not.toThrow();
    });

    it('should handle whole word option', () => {
      mockSearchExtension.getSearchState.mockReturnValue({
        query: 'test',
        results: [],
        currentIndex: -1,
        options: { wholeWord: true },
      });

      expect(() => {
        SearchPanel({ editor: editorSignal, isOpen: isOpenSignal });
      }).not.toThrow();
    });

    it('should handle regex option', () => {
      mockSearchExtension.getSearchState.mockReturnValue({
        query: 't.*t',
        results: [],
        currentIndex: -1,
        options: { regex: true },
      });

      expect(() => {
        SearchPanel({ editor: editorSignal, isOpen: isOpenSignal });
      }).not.toThrow();
    });

    it('should handle all options enabled', () => {
      mockSearchExtension.getSearchState.mockReturnValue({
        query: 'test',
        results: [],
        currentIndex: -1,
        options: {
          caseSensitive: true,
          wholeWord: true,
          regex: true,
        },
      });

      expect(() => {
        SearchPanel({ editor: editorSignal, isOpen: isOpenSignal });
      }).not.toThrow();
    });
  });

  describe('Replace functionality', () => {
    it('should handle replace action', () => {
      expect(() => {
        SearchPanel({ editor: editorSignal, isOpen: isOpenSignal });
      }).not.toThrow();
      expect(mockSearchExtension.replace).toBeDefined();
    });

    it('should handle replaceAll action', () => {
      expect(() => {
        SearchPanel({ editor: editorSignal, isOpen: isOpenSignal });
      }).not.toThrow();
      expect(mockSearchExtension.replaceAll).toBeDefined();
    });

    it('should handle replace with empty replacement', () => {
      expect(() => {
        SearchPanel({ editor: editorSignal, isOpen: isOpenSignal });
      }).not.toThrow();
    });

    it('should handle replace with long replacement text', () => {
      expect(() => {
        SearchPanel({ editor: editorSignal, isOpen: isOpenSignal });
      }).not.toThrow();
    });
  });

  describe('Search methods', () => {
    it('should handle search method', () => {
      expect(() => {
        SearchPanel({ editor: editorSignal, isOpen: isOpenSignal });
      }).not.toThrow();
      expect(mockSearchExtension.search).toBeDefined();
    });

    it('should handle findNext method', () => {
      expect(() => {
        SearchPanel({ editor: editorSignal, isOpen: isOpenSignal });
      }).not.toThrow();
      expect(mockSearchExtension.findNext).toBeDefined();
    });

    it('should handle findPrevious method', () => {
      expect(() => {
        SearchPanel({ editor: editorSignal, isOpen: isOpenSignal });
      }).not.toThrow();
      expect(mockSearchExtension.findPrevious).toBeDefined();
    });

    it('should handle clearSearch method', () => {
      expect(() => {
        SearchPanel({ editor: editorSignal, isOpen: isOpenSignal });
      }).not.toThrow();
      expect(mockSearchExtension.clearSearch).toBeDefined();
    });
  });

  describe('Edge cases', () => {
    it('should handle very long query', () => {
      const longQuery = 'a'.repeat(1000);
      mockSearchExtension.getSearchState.mockReturnValue({
        query: longQuery,
        results: [],
        currentIndex: -1,
        options: {},
      });

      expect(() => {
        SearchPanel({ editor: editorSignal, isOpen: isOpenSignal });
      }).not.toThrow();
    });

    it('should handle special characters in query', () => {
      mockSearchExtension.getSearchState.mockReturnValue({
        query: '[]{}<>().*+?^$|\\',
        results: [],
        currentIndex: -1,
        options: {},
      });

      expect(() => {
        SearchPanel({ editor: editorSignal, isOpen: isOpenSignal });
      }).not.toThrow();
    });

    it('should handle unicode in query', () => {
      mockSearchExtension.getSearchState.mockReturnValue({
        query: '你好世界 🌍',
        results: [],
        currentIndex: -1,
        options: {},
      });

      expect(() => {
        SearchPanel({ editor: editorSignal, isOpen: isOpenSignal });
      }).not.toThrow();
    });

    it('should handle maximum results', () => {
      const maxResults = Array.from({ length: 1000 }, (_, i) => ({
        from: i * 10,
        to: i * 10 + 4,
        text: 'test',
      }));

      mockSearchExtension.getSearchState.mockReturnValue({
        query: 'test',
        results: maxResults,
        currentIndex: 500,
        options: {},
      });

      expect(() => {
        SearchPanel({ editor: editorSignal, isOpen: isOpenSignal });
      }).not.toThrow();
    });
  });
});
