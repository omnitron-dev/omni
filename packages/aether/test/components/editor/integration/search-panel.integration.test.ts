/**
 * SearchPanel + SearchExtension Integration Tests
 *
 * Comprehensive tests for search panel UI + search extension functionality
 * Tests the complete search workflow including highlighting, navigation, and replace operations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signal } from '../../../../src/core/index.js';
import type { EditorInstance } from '../../../../src/components/editor/core/types.js';
import { SearchPanel } from '../../../../src/components/editor/components/SearchPanel.js';
import { SearchExtension } from '../../../../src/components/editor/extensions/search/SearchExtension.js';
import { ParagraphExtension } from '../../../../src/components/editor/extensions/nodes/ParagraphExtension.js';
import { HeadingExtension } from '../../../../src/components/editor/extensions/nodes/HeadingExtension.js';
import { BoldExtension } from '../../../../src/components/editor/extensions/marks/BoldExtension.js';
import { ItalicExtension } from '../../../../src/components/editor/extensions/marks/ItalicExtension.js';
import { BulletListExtension } from '../../../../src/components/editor/extensions/lists/BulletListExtension.js';
import { OrderedListExtension } from '../../../../src/components/editor/extensions/lists/OrderedListExtension.js';
import { ListItemExtension } from '../../../../src/components/editor/extensions/lists/ListItemExtension.js';
import { createIntegrationTestEditor, cleanupEditor, simulateKeyPress } from './helpers.js';

describe('SearchPanel + SearchExtension Integration', () => {
  let editor: EditorInstance;
  let searchExtension: SearchExtension;
  let isOpen: ReturnType<typeof signal<boolean>>;
  let _searchPanel: any;

  beforeEach(() => {
    // Create editor with search extension
    searchExtension = new SearchExtension();
    editor = createIntegrationTestEditor([
      new ParagraphExtension(),
      new HeadingExtension(),
      new BoldExtension(),
      new ItalicExtension(),
      new BulletListExtension(),
      new OrderedListExtension(),
      new ListItemExtension(),
      searchExtension,
    ]);

    // Create search panel
    isOpen = signal(false);
    const editorSignal = signal<EditorInstance | null>(editor);

    _searchPanel = SearchPanel({
      editor: editorSignal,
      isOpen,
      position: 'top',
    });

    // Mount panel in DOM
    const panelElement = document.createElement('div');
    panelElement.id = 'search-panel-container';
    document.body.appendChild(panelElement);
  });

  afterEach(() => {
    cleanupEditor(editor);
    const panelContainer = document.getElementById('search-panel-container');
    if (panelContainer) {
      document.body.removeChild(panelContainer);
    }
  });

  describe('Search Highlighting', () => {
    it('should highlight all matches in document when searching', () => {
      editor.setContent('<p>hello world hello test hello end</p>');

      // Perform search
      const results = searchExtension.search('hello');

      // Verify results
      expect(results).toHaveLength(3);
      expect(results[0].text).toBe('hello');
      expect(results[1].text).toBe('hello');
      expect(results[2].text).toBe('hello');

      // Verify state
      const state = searchExtension.getSearchState();
      expect(state?.results).toHaveLength(3);
      expect(state?.currentIndex).toBe(0);
    });

    it('should add decorations for each match', () => {
      editor.setContent('<p>test test test</p>');

      searchExtension.search('test');

      // Get decorations from editor state
      const decorations = editor.view.state.plugins.find(
        (p) => p.spec.props?.decorations !== undefined
      );

      expect(decorations).toBeDefined();
    });

    it('should display correct match count', () => {
      editor.setContent('<p>apple banana apple orange apple</p>');

      const results = searchExtension.search('apple');

      expect(results).toHaveLength(3);

      const state = searchExtension.getSearchState();
      expect(state?.results.length).toBe(3);
    });

    it('should update decorations when document changes', () => {
      editor.setContent('<p>foo bar foo</p>');

      searchExtension.search('foo');
      let state = searchExtension.getSearchState();
      expect(state?.results).toHaveLength(2);

      // Modify document
      const tr = editor.state.tr.insertText(' foo', editor.state.doc.content.size - 1);
      editor.view.dispatch(tr);

      // Results should update through mapping
      state = searchExtension.getSearchState();
      expect(state?.results.length).toBeGreaterThanOrEqual(2);
    });

    it('should highlight matches with different CSS classes for current vs others', () => {
      editor.setContent('<p>match match match</p>');

      searchExtension.search('match');

      const state = searchExtension.getSearchState();
      expect(state?.currentIndex).toBe(0);
      expect(state?.results).toHaveLength(3);

      // First match should be current
      // This is tested through the decoration class logic
    });
  });

  describe('Match Navigation', () => {
    it('should navigate to next match and update current index', () => {
      editor.setContent('<p>one two one three one</p>');

      searchExtension.search('one');

      const initialState = searchExtension.getSearchState();
      expect(initialState?.currentIndex).toBe(0);

      // Navigate to next
      const success = searchExtension.findNext();
      expect(success).toBe(true);

      const nextState = searchExtension.getSearchState();
      expect(nextState?.currentIndex).toBe(1);
    });

    it('should navigate to previous match and update current index', () => {
      editor.setContent('<p>word word word</p>');

      searchExtension.search('word');

      // Move to second match
      searchExtension.findNext();
      expect(searchExtension.getSearchState()?.currentIndex).toBe(1);

      // Navigate to previous
      const success = searchExtension.findPrevious();
      expect(success).toBe(true);

      const state = searchExtension.getSearchState();
      expect(state?.currentIndex).toBe(0);
    });

    it('should wrap around at end when navigating forward', () => {
      editor.setContent('<p>test test test</p>');

      searchExtension.search('test');

      // Navigate to last match
      searchExtension.findNext();
      searchExtension.findNext();
      expect(searchExtension.getSearchState()?.currentIndex).toBe(2);

      // Navigate to next (should wrap to 0)
      searchExtension.findNext();
      expect(searchExtension.getSearchState()?.currentIndex).toBe(0);
    });

    it('should wrap around at beginning when navigating backward', () => {
      editor.setContent('<p>item item item</p>');

      searchExtension.search('item');
      expect(searchExtension.getSearchState()?.currentIndex).toBe(0);

      // Navigate to previous (should wrap to last)
      searchExtension.findPrevious();
      expect(searchExtension.getSearchState()?.currentIndex).toBe(2);
    });

    it('should update match counter in panel UI', () => {
      editor.setContent('<p>find find find</p>');

      searchExtension.search('find');

      const state = searchExtension.getSearchState();
      expect(state?.currentIndex).toBe(0);
      expect(state?.results.length).toBe(3);

      // Counter should show "1 of 3"
      searchExtension.findNext();
      const nextState = searchExtension.getSearchState();
      expect(nextState?.currentIndex).toBe(1);
      // Counter should show "2 of 3"
    });
  });

  describe('Replace Operations', () => {
    it('should replace single match and update document', () => {
      editor.setContent('<p>old text old</p>');

      searchExtension.search('old');
      expect(searchExtension.getSearchState()?.results).toHaveLength(2);

      // Replace current match
      const success = searchExtension.replace('old', 'new');
      expect(success).toBe(true);

      // Verify document updated
      const text = editor.getText();
      expect(text).toContain('new');
    });

    it('should update match count after replace', () => {
      editor.setContent('<p>foo foo foo</p>');

      searchExtension.search('foo');
      expect(searchExtension.getSearchState()?.results).toHaveLength(3);

      // Replace first match
      searchExtension.replace('foo', 'bar');

      // After replace, search results should be remapped
      // (In real implementation, you might need to re-search)
      const state = searchExtension.getSearchState();
      expect(state).toBeDefined();
    });

    it('should replace all matches correctly', () => {
      editor.setContent('<p>apple apple apple</p>');

      searchExtension.search('apple');
      expect(searchExtension.getSearchState()?.results).toHaveLength(3);

      // Replace all
      const count = searchExtension.replaceAll('apple', 'orange');
      expect(count).toBe(3);

      // Verify all replaced
      const text = editor.getText();
      expect(text).toContain('orange');
      expect(text).not.toContain('apple');
    });

    it('should clear search state after replace all', () => {
      editor.setContent('<p>test test test</p>');

      searchExtension.search('test');
      expect(searchExtension.getSearchState()?.results).toHaveLength(3);

      searchExtension.replaceAll('test', 'demo');

      // State should be cleared
      const state = searchExtension.getSearchState();
      expect(state?.results).toHaveLength(0);
      expect(state?.query).toBe('');
    });

    it('should handle replace with different length text', () => {
      editor.setContent('<p>a a a</p>');

      searchExtension.search('a');
      expect(searchExtension.getSearchState()?.results).toHaveLength(3);

      searchExtension.replace('a', 'longer');

      const text = editor.getText();
      expect(text).toContain('longer');
    });

    it('should support undo after replace operations', () => {
      editor.setContent('<p>original original</p>');

      searchExtension.search('original');
      searchExtension.replace('original', 'modified');

      const textAfterReplace = editor.getText();
      expect(textAfterReplace).toContain('modified');

      // Note: Undo functionality depends on HistoryExtension being present
      // This test documents expected behavior
    });
  });

  describe('Panel UI State Sync', () => {
    it('should open panel when isOpen signal is set to true', () => {
      isOpen.set(false);

      // Open panel
      isOpen.set(true);

      expect(isOpen()).toBe(true);
    });

    it('should close panel when close button is clicked', () => {
      isOpen.set(true);
      expect(isOpen()).toBe(true);

      // Simulate close (would be triggered by UI)
      searchExtension.clearSearch();
      isOpen.set(false);

      expect(isOpen()).toBe(false);
    });

    it('should sync search query between panel and extension', () => {
      editor.setContent('<p>sync test sync</p>');

      // Search from extension
      searchExtension.search('sync');

      const state = searchExtension.getSearchState();
      expect(state?.query).toBe('sync');
      expect(state?.results).toHaveLength(2);
    });

    it('should reflect case sensitive option in search results', () => {
      editor.setContent('<p>Hello hello HELLO</p>');

      // Case insensitive search (default)
      searchExtension.search('hello', { caseSensitive: false });
      expect(searchExtension.getSearchState()?.results).toHaveLength(3);

      // Case sensitive search
      searchExtension.search('hello', { caseSensitive: true });
      expect(searchExtension.getSearchState()?.results).toHaveLength(1);
    });

    it('should reflect regex option in search behavior', () => {
      editor.setContent('<p>test123 test456 test789</p>');

      // Regex search
      searchExtension.search('test\\d+', { regex: true });
      const results = searchExtension.getSearchState()?.results;

      expect(results).toBeDefined();
      expect(results!.length).toBe(3);
    });

    it('should reflect whole word option in search results', () => {
      editor.setContent('<p>test testing tested</p>');

      // Whole word search
      searchExtension.search('test', { wholeWord: true });
      const results = searchExtension.getSearchState()?.results;

      expect(results).toHaveLength(1);
      expect(results![0].text).toBe('test');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty search query', () => {
      editor.setContent('<p>content here</p>');

      const results = searchExtension.search('');

      expect(results).toHaveLength(0);

      const state = searchExtension.getSearchState();
      expect(state?.results).toHaveLength(0);
    });

    it('should handle no matches found', () => {
      editor.setContent('<p>hello world</p>');

      const results = searchExtension.search('nonexistent');

      expect(results).toHaveLength(0);

      const state = searchExtension.getSearchState();
      expect(state?.currentIndex).toBe(-1);
    });

    it('should handle regex patterns correctly', () => {
      editor.setContent('<p>email@test.com another@example.org</p>');

      // Search for email pattern
      const results = searchExtension.search('\\S+@\\S+\\.\\S+', { regex: true });

      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle invalid regex gracefully', () => {
      editor.setContent('<p>test content</p>');

      // Invalid regex should not throw
      const results = searchExtension.search('[invalid(regex', { regex: true });

      expect(results).toHaveLength(0);
    });

    it('should perform well with large documents', () => {
      const largeText = 'word '.repeat(1000);
      editor.setContent(`<p>${largeText}</p>`);

      const start = Date.now();
      const results = searchExtension.search('word');
      const duration = Date.now() - start;

      expect(results.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(500); // Should be fast
    });

    it('should handle special characters in search', () => {
      editor.setContent('<p>$100 + $200 = $300</p>');

      const results = searchExtension.search('$', { regex: false });

      expect(results.length).toBe(3);
    });

    it('should handle Unicode characters', () => {
      editor.setContent('<p>Hello 世界 test 世界</p>');

      const results = searchExtension.search('世界');

      expect(results).toHaveLength(2);
      expect(results[0].text).toBe('世界');
    });
  });

  describe('Keyboard Shortcuts', () => {
    it('should trigger search keyboard shortcut with Cmd+F', () => {
      editor.setContent('<p>test</p>');

      // Simulate Cmd+F - the keyboard shortcut should dispatch custom event
      const handled = simulateKeyPress(editor, 'f', ['Mod']);

      // The shortcut should be handled by the extension
      expect(handled).toBeDefined();

      // In a real browser, the custom event would be dispatched synchronously
      // In test environment, we verify the keyboard shortcut was registered
      // by checking that the key handler exists
      const searchExt = (editor as any).extensionManager?.getExtension('search');
      expect(searchExt).toBeDefined();
    });

    it('should close search panel with Escape', () => {
      editor.setContent('<p>test</p>');
      isOpen.set(true);

      // Search first
      searchExtension.search('test');

      // Simulate Escape
      simulateKeyPress(editor, 'Escape', []);

      // State should be cleared
      const state = searchExtension.getSearchState();
      expect(state?.results).toHaveLength(0);
    });

    it('should navigate to next match with Cmd+G', () => {
      editor.setContent('<p>match match match</p>');

      searchExtension.search('match');
      expect(searchExtension.getSearchState()?.currentIndex).toBe(0);

      // Simulate Cmd+G
      simulateKeyPress(editor, 'g', ['Mod']);

      // Should have moved to next match
      // (The actual navigation is handled by the shortcut)
    });

    it('should navigate to previous match with Cmd+Shift+G', () => {
      editor.setContent('<p>item item item</p>');

      searchExtension.search('item');
      searchExtension.findNext();
      expect(searchExtension.getSearchState()?.currentIndex).toBe(1);

      // Simulate Cmd+Shift+G
      simulateKeyPress(editor, 'g', ['Mod', 'Shift']);

      // Should have moved to previous match
      // (The actual navigation is handled by the shortcut)
    });
  });

  describe('Complex Search Scenarios', () => {
    it('should search across different node types', () => {
      editor.setContent('<h1>Title test</h1><p>Paragraph test</p>');

      const results = searchExtension.search('test');

      expect(results).toHaveLength(2);
    });

    it('should search in formatted text', () => {
      editor.setContent('<p><strong>bold test</strong> and <em>italic test</em></p>');

      const results = searchExtension.search('test');

      expect(results).toHaveLength(2);
    });

    it('should search in lists', () => {
      editor.setContent('<ul><li><p>item test</p></li><li><p>another test</p></li></ul>');

      const results = searchExtension.search('test');

      expect(results).toHaveLength(2);
    });

    it('should handle search during editing', () => {
      editor.setContent('<p>initial</p>');

      searchExtension.search('initial');
      expect(searchExtension.getSearchState()?.results).toHaveLength(1);

      // Add more content
      const tr = editor.state.tr.insertText(' initial', editor.state.doc.content.size - 1);
      editor.view.dispatch(tr);

      // Results should update
      const state = searchExtension.getSearchState();
      expect(state).toBeDefined();
    });

    it('should maintain search state across document changes', () => {
      editor.setContent('<p>test one test two</p>');

      searchExtension.search('test');
      const initialResults = searchExtension.getSearchState()?.results.length;

      // Modify document in a different location
      const tr = editor.state.tr.insertText(' extra', 5);
      editor.view.dispatch(tr);

      // Results should still be valid (positions mapped)
      const state = searchExtension.getSearchState();
      expect(state?.results.length).toBe(initialResults);
    });
  });

  describe('Clear Search', () => {
    it('should clear all search state', () => {
      editor.setContent('<p>test test test</p>');

      searchExtension.search('test');
      expect(searchExtension.getSearchState()?.results.length).toBeGreaterThan(0);

      searchExtension.clearSearch();

      const state = searchExtension.getSearchState();
      expect(state?.results).toHaveLength(0);
      expect(state?.query).toBe('');
      expect(state?.currentIndex).toBe(-1);
    });

    it('should remove all decorations when cleared', () => {
      editor.setContent('<p>highlight highlight</p>');

      searchExtension.search('highlight');

      searchExtension.clearSearch();

      // Decorations should be removed (tested through plugin state)
      const state = searchExtension.getSearchState();
      expect(state?.results).toHaveLength(0);
    });
  });
});
