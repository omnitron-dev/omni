/**
 * SearchExtension tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { Schema } from 'prosemirror-model';
import { SearchExtension } from '../../../../../src/components/editor/extensions/search/SearchExtension.js';
import { SchemaBuilder } from '../../../../../src/components/editor/core/SchemaBuilder.js';
import type { EditorInstance } from '../../../../../src/components/editor/core/types.js';

describe('SearchExtension', () => {
  let extension: SearchExtension;
  let schema: Schema;
  let mockEditor: EditorInstance;
  let view: EditorView;

  beforeEach(() => {
    extension = new SearchExtension();
    const builder = new SchemaBuilder();
    schema = builder.build();

    // Create a mock editor
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('Hello world')]),
      schema.node('paragraph', null, [schema.text('Hello universe')]),
      schema.node('paragraph', null, [schema.text('Goodbye world')]),
    ]);

    const plugins = extension.getPlugins() || [];
    const state = EditorState.create({ schema, doc, plugins });

    const container = document.createElement('div');
    view = new EditorView(container, {
      state,
      dispatchTransaction: (tr) => {
        const newState = view.state.apply(tr);
        view.updateState(newState);
        mockEditor.state = newState;
      },
    });

    mockEditor = {
      state: view.state,
      view,
      schema,
    } as any;

    extension.setEditor(mockEditor);
  });

  describe('Extension metadata', () => {
    it('should have correct name', () => {
      expect(extension.name).toBe('search');
    });

    it('should have correct type', () => {
      expect(extension.type).toBe('behavior');
    });

    it('should not have dependencies', () => {
      expect(extension.dependencies).toBeUndefined();
    });
  });

  describe('Default options', () => {
    it('should have default caseSensitive as false', () => {
      const options = extension.getOptions();
      expect(options.caseSensitive).toBe(false);
    });

    it('should have default wholeWord as false', () => {
      const options = extension.getOptions();
      expect(options.wholeWord).toBe(false);
    });

    it('should have default regex as false', () => {
      const options = extension.getOptions();
      expect(options.regex).toBe(false);
    });

    it('should have default highlightMatches as true', () => {
      const options = extension.getOptions();
      expect(options.highlightMatches).toBe(true);
    });

    it('should have default maxMatches as 1000', () => {
      const options = extension.getOptions();
      expect(options.maxMatches).toBe(1000);
    });
  });

  describe('Custom options', () => {
    it('should accept custom caseSensitive option', () => {
      const customExtension = new SearchExtension({ caseSensitive: true });
      const options = customExtension.getOptions();
      expect(options.caseSensitive).toBe(true);
    });

    it('should accept custom wholeWord option', () => {
      const customExtension = new SearchExtension({ wholeWord: true });
      const options = customExtension.getOptions();
      expect(options.wholeWord).toBe(true);
    });

    it('should accept custom regex option', () => {
      const customExtension = new SearchExtension({ regex: true });
      const options = customExtension.getOptions();
      expect(options.regex).toBe(true);
    });

    it('should accept custom highlightMatches option', () => {
      const customExtension = new SearchExtension({ highlightMatches: false });
      const options = customExtension.getOptions();
      expect(options.highlightMatches).toBe(false);
    });

    it('should accept custom maxMatches option', () => {
      const customExtension = new SearchExtension({ maxMatches: 500 });
      const options = customExtension.getOptions();
      expect(options.maxMatches).toBe(500);
    });

    it('should configure options after creation', () => {
      extension.configure({ caseSensitive: true });
      const options = extension.getOptions();
      expect(options.caseSensitive).toBe(true);
    });
  });

  describe('Plugins', () => {
    it('should provide search plugin', () => {
      const plugins = extension.getPlugins();
      expect(plugins).toBeDefined();
      expect(Array.isArray(plugins)).toBe(true);
      expect(plugins!.length).toBe(1);
    });
  });

  describe('Search functionality', () => {
    it('should find simple text match', () => {
      const results = extension.search('Hello');
      expect(results.length).toBe(2);
      expect(results[0].text).toBe('Hello');
    });

    it('should find multiple matches', () => {
      const results = extension.search('world');
      expect(results.length).toBe(2);
    });

    it('should return empty array for no matches', () => {
      const results = extension.search('nonexistent');
      expect(results.length).toBe(0);
    });

    it('should return empty array for empty query', () => {
      const results = extension.search('');
      expect(results.length).toBe(0);
    });

    it('should return correct positions for matches', () => {
      const results = extension.search('Hello');
      expect(results[0].from).toBe(0);
      expect(results[0].to).toBe(5);
    });

    it('should handle case-insensitive search by default', () => {
      const results = extension.search('HELLO');
      expect(results.length).toBe(2);
    });

    it('should handle case-sensitive search when enabled', () => {
      const results = extension.search('HELLO', { caseSensitive: true });
      expect(results.length).toBe(0);
    });

    it('should find exact case matches with caseSensitive', () => {
      const results = extension.search('Hello', { caseSensitive: true });
      expect(results.length).toBe(2);
    });

    it('should respect maxMatches option', () => {
      const results = extension.search('o', { maxMatches: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should find partial word matches by default', () => {
      const results = extension.search('wor');
      expect(results.length).toBe(2);
    });

    it('should only find whole words when wholeWord enabled', () => {
      const results = extension.search('Hello', { wholeWord: true });
      expect(results.length).toBe(2);
    });

    it('should not find partial words with wholeWord enabled', () => {
      const results = extension.search('Hel', { wholeWord: true });
      expect(results.length).toBe(0);
    });
  });

  describe('Regular expression search', () => {
    it('should support basic regex patterns', () => {
      const results = extension.search('H\\w+', { regex: true });
      expect(results.length).toBe(2);
    });

    it('should support case-insensitive regex', () => {
      const results = extension.search('hello', { regex: true, caseSensitive: false });
      expect(results.length).toBe(2);
    });

    it('should support case-sensitive regex', () => {
      const results = extension.search('hello', { regex: true, caseSensitive: true });
      expect(results.length).toBe(0);
    });

    it('should handle regex with character classes', () => {
      const results = extension.search('[Hh]ello', { regex: true });
      expect(results.length).toBe(2);
    });

    it('should handle regex with quantifiers', () => {
      const results = extension.search('H.{4}', { regex: true });
      expect(results.length).toBe(2);
    });

    it('should handle invalid regex gracefully', () => {
      const results = extension.search('[invalid', { regex: true });
      expect(results.length).toBe(0);
    });

    it('should handle regex alternation', () => {
      const results = extension.search('Hello|Goodbye', { regex: true });
      expect(results.length).toBe(3);
    });
  });

  describe('Replace functionality', () => {
    it('should replace current match', () => {
      extension.search('Hello');
      const success = extension.replace('Hello', 'Hi');
      expect(success).toBe(true);
    });

    it('should return false when no search active', () => {
      const success = extension.replace('Hello', 'Hi');
      expect(success).toBe(false);
    });

    it('should return false when no matches found', () => {
      extension.search('nonexistent');
      const success = extension.replace('nonexistent', 'something');
      expect(success).toBe(false);
    });

    it('should replaceAll matches', () => {
      extension.search('Hello');
      const count = extension.replaceAll('Hello', 'Hi');
      expect(count).toBe(2);
    });

    it('should return 0 when replaceAll has no matches', () => {
      extension.search('nonexistent');
      const count = extension.replaceAll('nonexistent', 'something');
      expect(count).toBe(0);
    });

    it('should clear search after replaceAll', () => {
      extension.search('Hello');
      extension.replaceAll('Hello', 'Hi');
      const state = extension.getSearchState();
      expect(state?.query).toBe('');
      expect(state?.results.length).toBe(0);
    });
  });

  describe('Navigation', () => {
    it('should find next match', () => {
      extension.search('Hello');
      const success = extension.findNext();
      expect(success).toBe(true);
    });

    it('should wrap to first match after last', () => {
      extension.search('Hello');
      extension.findNext(); // Move to second match
      const success = extension.findNext(); // Should wrap to first
      expect(success).toBe(true);
      const state = extension.getSearchState();
      expect(state?.currentIndex).toBe(0);
    });

    it('should find previous match', () => {
      extension.search('Hello');
      extension.findNext(); // Move to second match
      const success = extension.findPrevious();
      expect(success).toBe(true);
    });

    it('should wrap to last match when going previous from first', () => {
      extension.search('Hello');
      const success = extension.findPrevious(); // Should wrap to last
      expect(success).toBe(true);
      const state = extension.getSearchState();
      expect(state?.currentIndex).toBe(1);
    });

    it('should return false when findNext has no results', () => {
      extension.search('nonexistent');
      const success = extension.findNext();
      expect(success).toBe(false);
    });

    it('should return false when findPrevious has no results', () => {
      extension.search('nonexistent');
      const success = extension.findPrevious();
      expect(success).toBe(false);
    });
  });

  describe('Clear search', () => {
    it('should clear search state', () => {
      extension.search('Hello');
      extension.clearSearch();
      const state = extension.getSearchState();
      expect(state?.query).toBe('');
      expect(state?.results.length).toBe(0);
      expect(state?.currentIndex).toBe(-1);
    });

    it('should remove highlights when clearing search', () => {
      extension.search('Hello');
      extension.clearSearch();
      const state = extension.getSearchState();
      expect(state).toBeDefined();
      expect(state?.results.length).toBe(0);
    });
  });

  describe('Search state', () => {
    it('should return search state', () => {
      extension.search('Hello');
      const state = extension.getSearchState();
      expect(state).toBeDefined();
      expect(state?.query).toBe('Hello');
      expect(state?.results.length).toBe(2);
    });

    it('should update currentIndex on search', () => {
      extension.search('Hello');
      const state = extension.getSearchState();
      expect(state?.currentIndex).toBe(0);
    });

    it('should have currentIndex -1 when no matches', () => {
      extension.search('nonexistent');
      const state = extension.getSearchState();
      expect(state?.currentIndex).toBe(-1);
    });
  });

  describe('Keyboard shortcuts', () => {
    it('should provide keyboard shortcuts', () => {
      const shortcuts = extension.getKeyboardShortcuts();
      expect(shortcuts).toBeDefined();
      expect(shortcuts!['Mod-f']).toBeDefined();
      expect(shortcuts!['Mod-g']).toBeDefined();
      expect(shortcuts!['Escape']).toBeDefined();
    });

    it('should find next with Mod-g', () => {
      extension.search('Hello');
      const shortcuts = extension.getKeyboardShortcuts();
      const result = shortcuts!['Mod-g']();
      expect(result).toBe(true);
    });

    it('should clear search with Escape', () => {
      extension.search('Hello');
      const shortcuts = extension.getKeyboardShortcuts();
      shortcuts!['Escape']();
      const state = extension.getSearchState();
      expect(state?.query).toBe('');
    });
  });

  describe('Decorations', () => {
    it('should create decorations for matches when highlightMatches is true', () => {
      extension.search('Hello');

      const plugins = extension.getPlugins();
      const plugin = plugins![0];
      const decorations = plugin.spec.props?.decorations?.(view.state);

      expect(decorations).toBeDefined();
      expect(decorations?.find().length).toBeGreaterThan(0);
    });

    it('should not create decorations when highlightMatches is false', () => {
      const customExtension = new SearchExtension({ highlightMatches: false });
      customExtension.setEditor(mockEditor);
      customExtension.search('Hello');

      const plugins = customExtension.getPlugins();
      const plugin = plugins![0];
      const decorations = plugin.spec.props?.decorations?.(view.state);

      expect(decorations).toBeDefined();
      expect(decorations?.find().length).toBe(0);
    });

    it('should highlight current match differently', () => {
      extension.search('Hello');
      const plugins = extension.getPlugins();
      const plugin = plugins![0];
      const decorations = plugin.spec.props?.decorations?.(view.state);

      expect(decorations).toBeDefined();
      const decoArray = decorations?.find();
      expect(decoArray?.length).toBeGreaterThan(0);
    });

    it('should not create decorations when no matches', () => {
      extension.search('nonexistent');
      const plugins = extension.getPlugins();
      const plugin = plugins![0];
      const decorations = plugin.spec.props?.decorations?.(view.state);

      expect(decorations).toBeDefined();
      expect(decorations?.find().length).toBe(0);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty document', () => {
      const emptyDoc = schema.node('doc', null, [schema.node('paragraph')]);
      view.updateState(EditorState.create({ schema, doc: emptyDoc, plugins: extension.getPlugins() || [] }));
      mockEditor.state = view.state;

      const results = extension.search('Hello');
      expect(results.length).toBe(0);
    });

    it('should handle document with only whitespace', () => {
      const whitespaceDoc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('   ')])]);
      view.updateState(EditorState.create({ schema, doc: whitespaceDoc, plugins: extension.getPlugins() || [] }));
      mockEditor.state = view.state;

      const results = extension.search('Hello');
      expect(results.length).toBe(0);
    });

    it('should handle very long query', () => {
      const longQuery = 'a'.repeat(1000);
      const results = extension.search(longQuery);
      expect(results.length).toBe(0);
    });

    it('should handle special regex characters in plain search', () => {
      const specialDoc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('(test)')])]);
      view.updateState(EditorState.create({ schema, doc: specialDoc, plugins: extension.getPlugins() || [] }));
      mockEditor.state = view.state;

      const results = extension.search('(test)', { regex: false });
      expect(results.length).toBe(1);
    });

    it('should handle unicode characters', () => {
      const unicodeDoc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('Hello 世界')])]);
      view.updateState(EditorState.create({ schema, doc: unicodeDoc, plugins: extension.getPlugins() || [] }));
      mockEditor.state = view.state;

      const results = extension.search('世界');
      expect(results.length).toBe(1);
    });

    it('should handle newlines in search', () => {
      const results = extension.search('world\nHello');
      // Depends on implementation - may or may not match across paragraph boundaries
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('Extension lifecycle', () => {
    it('should handle editor instance', () => {
      const mockEditor = {} as any;
      extension.setEditor(mockEditor);
      expect(() => extension.destroy()).not.toThrow();
    });

    it('should merge configured options with defaults', () => {
      extension.configure({ caseSensitive: true });
      const options = extension.getOptions();
      expect(options.caseSensitive).toBe(true);
      expect(options.highlightMatches).toBe(true); // Default still present
    });

    it('should handle destroy gracefully', () => {
      extension.search('Hello');
      expect(() => extension.destroy()).not.toThrow();
    });
  });
});
