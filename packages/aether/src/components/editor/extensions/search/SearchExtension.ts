/**
 * SearchExtension - Search and replace functionality
 *
 * Provides search and replace capabilities with:
 * - Case-sensitive search
 * - Whole word matching
 * - Regular expression support
 * - Match highlighting
 * - Navigation (findNext, findPrevious)
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { Extension } from '../../core/Extension.js';

export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  highlightMatches?: boolean;
  maxMatches?: number;
}

export interface SearchResult {
  from: number;
  to: number;
  text: string;
}

interface SearchPluginState {
  query: string;
  results: SearchResult[];
  currentIndex: number;
  options: Required<SearchOptions>;
}

export class SearchExtension extends Extension<SearchOptions> {
  readonly name = 'search';
  readonly type = 'behavior' as const;

  private pluginKey = new PluginKey<SearchPluginState>('search');

  protected override defaultOptions(): SearchOptions {
    return {
      caseSensitive: false,
      wholeWord: false,
      regex: false,
      highlightMatches: true,
      maxMatches: 1000,
    };
  }

  override getPlugins() {
    return [
      new Plugin<SearchPluginState>({
        key: this.pluginKey,
        state: {
          init: () => ({
            query: '',
            results: [],
            currentIndex: -1,
            options: this.getRequiredOptions(),
          }),
          apply: (tr, value) => {
            // Map results through transaction
            if (tr.docChanged && value.results.length > 0) {
              const results = value.results
                .map((result) => {
                  const from = tr.mapping.map(result.from);
                  const to = tr.mapping.map(result.to);
                  return { ...result, from, to };
                })
                .filter((result) => result.from < result.to);

              return {
                ...value,
                results,
              };
            }

            // Check for meta updates
            const meta = tr.getMeta(this.pluginKey);
            if (meta) {
              return { ...value, ...meta };
            }

            return value;
          },
        },
        props: {
          decorations: (state) => {
            const pluginState = this.pluginKey.getState(state);
            if (!pluginState || !pluginState.options.highlightMatches || pluginState.results.length === 0) {
              return DecorationSet.empty;
            }

            const decorations: Decoration[] = [];

            pluginState.results.forEach((result, index) => {
              const isCurrent = index === pluginState.currentIndex;
              decorations.push(
                Decoration.inline(result.from, result.to, {
                  class: isCurrent ? 'search-result search-result-current' : 'search-result',
                }),
              );
            });

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  }

  override getKeyboardShortcuts() {
    return {
      'Mod-f': () => {
        // Trigger search panel (handled by SearchPanel component)
        const event = new CustomEvent('editor:openSearch');
        document.dispatchEvent(event);
        return true;
      },
      'Mod-g': () => {
        this.findNext();
        return true;
      },
      'Mod-Shift-g': () => {
        this.findPrevious();
        return true;
      },
      Escape: () => {
        this.clearSearch();
        const event = new CustomEvent('editor:closeSearch');
        document.dispatchEvent(event);
        return true;
      },
    };
  }

  /**
   * Search for a query in the document
   */
  search(query: string, options?: SearchOptions): SearchResult[] {
    if (!this.editor) {
      return [];
    }

    const searchOptions = { ...this.getRequiredOptions(), ...options };
    const results = this.findMatches(this.editor.state.doc, query, searchOptions);

    // Update plugin state
    const tr = this.editor.state.tr;
    tr.setMeta(this.pluginKey, {
      query,
      results,
      currentIndex: results.length > 0 ? 0 : -1,
      options: searchOptions,
    });
    this.editor.view.dispatch(tr);

    return results;
  }

  /**
   * Replace the current match
   */
  replace(query: string, replacement: string): boolean {
    if (!this.editor) {
      return false;
    }

    const pluginState = this.pluginKey.getState(this.editor.state);
    if (!pluginState || pluginState.currentIndex === -1 || pluginState.results.length === 0) {
      return false;
    }

    const result = pluginState.results[pluginState.currentIndex];
    const tr = this.editor.state.tr;
    tr.replaceWith(result.from, result.to, this.editor.state.schema.text(replacement));
    this.editor.view.dispatch(tr);

    return true;
  }

  /**
   * Replace all matches
   */
  replaceAll(query: string, replacement: string): number {
    if (!this.editor) {
      return 0;
    }

    const pluginState = this.pluginKey.getState(this.editor.state);
    if (!pluginState || pluginState.results.length === 0) {
      return 0;
    }

    const tr = this.editor.state.tr;

    // Replace in reverse order to maintain positions
    const results = [...pluginState.results].reverse();
    results.forEach((result) => {
      tr.replaceWith(result.from, result.to, this.editor.state.schema.text(replacement));
    });

    this.editor.view.dispatch(tr);

    const count = results.length;

    // Clear search
    this.clearSearch();

    return count;
  }

  /**
   * Clear search state
   */
  clearSearch(): void {
    if (!this.editor) {
      return;
    }

    const tr = this.editor.state.tr;
    tr.setMeta(this.pluginKey, {
      query: '',
      results: [],
      currentIndex: -1,
      options: this.getRequiredOptions(),
    });
    this.editor.view.dispatch(tr);
  }

  /**
   * Find next match
   */
  findNext(): boolean {
    if (!this.editor) {
      return false;
    }

    const pluginState = this.pluginKey.getState(this.editor.state);
    if (!pluginState || pluginState.results.length === 0) {
      return false;
    }

    const nextIndex = (pluginState.currentIndex + 1) % pluginState.results.length;
    const tr = this.editor.state.tr;
    tr.setMeta(this.pluginKey, {
      ...pluginState,
      currentIndex: nextIndex,
    });
    this.editor.view.dispatch(tr);

    // Scroll to match
    this.scrollToMatch(pluginState.results[nextIndex]);

    return true;
  }

  /**
   * Find previous match
   */
  findPrevious(): boolean {
    if (!this.editor) {
      return false;
    }

    const pluginState = this.pluginKey.getState(this.editor.state);
    if (!pluginState || pluginState.results.length === 0) {
      return false;
    }

    const prevIndex = pluginState.currentIndex - 1 < 0 ? pluginState.results.length - 1 : pluginState.currentIndex - 1;
    const tr = this.editor.state.tr;
    tr.setMeta(this.pluginKey, {
      ...pluginState,
      currentIndex: prevIndex,
    });
    this.editor.view.dispatch(tr);

    // Scroll to match
    this.scrollToMatch(pluginState.results[prevIndex]);

    return true;
  }

  /**
   * Get current search state
   */
  getSearchState(): SearchPluginState | undefined {
    if (!this.editor) {
      return undefined;
    }

    return this.pluginKey.getState(this.editor.state);
  }

  /**
   * Find all matches in the document
   */
  private findMatches(doc: PMNode, query: string, options: Required<SearchOptions>): SearchResult[] {
    if (!query) {
      return [];
    }

    const results: SearchResult[] = [];
    const text = doc.textBetween(0, doc.content.size, '\n', '\0');

    try {
      if (options.regex) {
        // Regex search
        const flags = options.caseSensitive ? 'g' : 'gi';
        const regex = new RegExp(query, flags);
        let match;

        while ((match = regex.exec(text)) !== null) {
          if (results.length >= options.maxMatches) {
            break;
          }

          const from = match.index;
          const to = from + match[0].length;

          if (this.isValidMatch(text, from, to, options)) {
            results.push({
              from,
              to,
              text: match[0],
            });
          }
        }
      } else {
        // Plain text search
        const searchText = options.caseSensitive ? query : query.toLowerCase();
        const compareText = options.caseSensitive ? text : text.toLowerCase();

        let startIndex = 0;
        while (startIndex < text.length) {
          if (results.length >= options.maxMatches) {
            break;
          }

          const index = compareText.indexOf(searchText, startIndex);
          if (index === -1) {
            break;
          }

          const from = index;
          const to = index + query.length;

          if (this.isValidMatch(text, from, to, options)) {
            results.push({
              from,
              to,
              text: text.substring(from, to),
            });
          }

          startIndex = index + 1;
        }
      }
    } catch (error) {
      // Invalid regex or other error
      console.error('Search error:', error);
    }

    return results;
  }

  /**
   * Check if a match is valid based on options
   */
  private isValidMatch(text: string, from: number, to: number, options: Required<SearchOptions>): boolean {
    if (!options.wholeWord) {
      return true;
    }

    // Check word boundaries
    const before = from > 0 ? text[from - 1] : ' ';
    const after = to < text.length ? text[to] : ' ';

    const wordBoundaryRegex = /\W/;
    return wordBoundaryRegex.test(before) && wordBoundaryRegex.test(after);
  }

  /**
   * Scroll to a match
   */
  private scrollToMatch(result: SearchResult): void {
    if (!this.editor) {
      return;
    }

    const coords = this.editor.view.coordsAtPos(result.from);
    const scrollParent = this.editor.view.dom.parentElement;

    if (scrollParent) {
      scrollParent.scrollTop = coords.top - scrollParent.offsetTop - 100;
    }
  }

  /**
   * Get required options with defaults
   */
  private getRequiredOptions(): Required<SearchOptions> {
    return {
      caseSensitive: this.options.caseSensitive ?? false,
      wholeWord: this.options.wholeWord ?? false,
      regex: this.options.regex ?? false,
      highlightMatches: this.options.highlightMatches ?? true,
      maxMatches: this.options.maxMatches ?? 1000,
    };
  }
}
