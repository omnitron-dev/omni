/**
 * SearchPanel - Search and replace UI component
 *
 * Provides a UI for searching and replacing text in the editor
 */

import { defineComponent, signal, computed, onMount, onCleanup, type Signal } from '../../../core/index.js';
import { jsx } from '../../../jsxruntime/runtime.js';
import type { EditorInstance } from '../core/types.js';
import type { SearchExtension } from '../extensions/search/SearchExtension.js';

export interface SearchPanelProps {
  editor: Signal<EditorInstance | null>;
  isOpen: Signal<boolean>;
  position?: 'top' | 'bottom';
  class?: string;
}

export const SearchPanel = defineComponent<SearchPanelProps>((props) => {
  const searchQuery = signal('');
  const replaceText = signal('');
  const showReplace = signal(false);
  const caseSensitive = signal(false);
  const wholeWord = signal(false);
  const regexEnabled = signal(false);

  let searchInputRef: HTMLInputElement | null = null;
  let _replaceInputRef: HTMLInputElement | null = null;

  const matchCount = computed(() => {
    const editor = props.editor();
    if (!editor) return { current: 0, total: 0 };

    const ext = (editor as any).extensionManager?.getExtension('search') as SearchExtension | undefined;
    if (!ext) return { current: 0, total: 0 };

    const state = ext.getSearchState();
    if (!state) return { current: 0, total: 0 };

    return {
      current: state.currentIndex + 1,
      total: state.results.length,
    };
  });

  const handleSearch = () => {
    const editor = props.editor();
    if (!editor) return;

    const ext = (editor as any).extensionManager?.getExtension('search') as SearchExtension | undefined;
    if (!ext) return;

    ext.search(searchQuery(), {
      caseSensitive: caseSensitive(),
      wholeWord: wholeWord(),
      regex: regexEnabled(),
    });
  };

  const handleReplace = () => {
    const editor = props.editor();
    if (!editor) return;

    const ext = (editor as any).extensionManager?.getExtension('search') as SearchExtension | undefined;
    if (!ext) return;

    ext.replace(searchQuery(), replaceText());
  };

  const handleReplaceAll = () => {
    const editor = props.editor();
    if (!editor) return;

    const ext = (editor as any).extensionManager?.getExtension('search') as SearchExtension | undefined;
    if (!ext) return;

    ext.replaceAll(searchQuery(), replaceText());
  };

  const handleFindNext = () => {
    const editor = props.editor();
    if (!editor) return;

    const ext = (editor as any).extensionManager?.getExtension('search') as SearchExtension | undefined;
    if (!ext) return;

    ext.findNext();
  };

  const handleFindPrevious = () => {
    const editor = props.editor();
    if (!editor) return;

    const ext = (editor as any).extensionManager?.getExtension('search') as SearchExtension | undefined;
    if (!ext) return;

    ext.findPrevious();
  };

  const handleClose = () => {
    props.isOpen.set(false);
    const editor = props.editor();
    if (!editor) return;

    const ext = (editor as any).extensionManager?.getExtension('search') as SearchExtension | undefined;
    if (!ext) return;

    ext.clearSearch();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (e.shiftKey) {
        e.preventDefault();
        handleFindPrevious();
      } else {
        e.preventDefault();
        handleSearch();
        handleFindNext();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleClose();
    }
  };

  onMount(() => {
    // Focus search input when panel opens
    if (props.isOpen() && searchInputRef) {
      searchInputRef.focus();
    }

    // Listen for open/close events
    const handleOpenSearch = () => {
      props.isOpen.set(true);
      setTimeout(() => {
        if (searchInputRef) {
          searchInputRef.focus();
          searchInputRef.select();
        }
      }, 0);
    };

    const handleCloseSearch = () => {
      props.isOpen.set(false);
    };

    document.addEventListener('editor:openSearch', handleOpenSearch);
    document.addEventListener('editor:closeSearch', handleCloseSearch);

    onCleanup(() => {
      document.removeEventListener('editor:openSearch', handleOpenSearch);
      document.removeEventListener('editor:closeSearch', handleCloseSearch);
    });
  });

  return () => {
    if (!props.isOpen()) return null;

    const position = props.position || 'top';
    const matches = matchCount();

    return jsx('div', {
      class: `search-panel search-panel-${position} ${props.class || ''}`,
      children: [
        // Search input row
        jsx('div', {
          class: 'search-panel-row',
          children: [
            // Search input
            jsx('input', {
              type: 'text',
              class: 'search-panel-input',
              placeholder: 'Search...',
              value: searchQuery(),
              onInput: (e: Event) => {
                const target = e.target as HTMLInputElement;
                searchQuery.set(target.value);
                handleSearch();
              },
              onKeyDown: handleKeyDown,
              ref: (el: HTMLInputElement) => {
                searchInputRef = el;
              },
            }),

            // Match counter
            jsx('div', {
              class: 'search-panel-counter',
              children: matches.total > 0 ? `${matches.current} of ${matches.total}` : 'No matches',
            }),

            // Navigation buttons
            jsx('button', {
              class: 'search-panel-button',
              title: 'Previous match (Shift+Enter)',
              onClick: handleFindPrevious,
              disabled: matches.total === 0,
              children: '↑',
            }),

            jsx('button', {
              class: 'search-panel-button',
              title: 'Next match (Enter)',
              onClick: handleFindNext,
              disabled: matches.total === 0,
              children: '↓',
            }),

            // Options
            jsx('button', {
              class: `search-panel-button ${caseSensitive() ? 'active' : ''}`,
              title: 'Case sensitive',
              onClick: () => {
                caseSensitive.set(!caseSensitive());
                handleSearch();
              },
              children: 'Aa',
            }),

            jsx('button', {
              class: `search-panel-button ${wholeWord() ? 'active' : ''}`,
              title: 'Whole word',
              onClick: () => {
                wholeWord.set(!wholeWord());
                handleSearch();
              },
              children: 'W',
            }),

            jsx('button', {
              class: `search-panel-button ${regexEnabled() ? 'active' : ''}`,
              title: 'Regular expression',
              onClick: () => {
                regexEnabled.set(!regexEnabled());
                handleSearch();
              },
              children: '.*',
            }),

            // Replace toggle
            jsx('button', {
              class: `search-panel-button ${showReplace() ? 'active' : ''}`,
              title: 'Toggle replace',
              onClick: () => showReplace.set(!showReplace()),
              children: '⇄',
            }),

            // Close button
            jsx('button', {
              class: 'search-panel-button search-panel-close',
              title: 'Close (Escape)',
              onClick: handleClose,
              children: '×',
            }),
          ],
        }),

        // Replace input row (conditional)
        showReplace()
          ? jsx('div', {
              class: 'search-panel-row',
              children: [
                // Replace input
                jsx('input', {
                  type: 'text',
                  class: 'search-panel-input',
                  placeholder: 'Replace...',
                  value: replaceText(),
                  onInput: (e: Event) => {
                    const target = e.target as HTMLInputElement;
                    replaceText.set(target.value);
                  },
                  onKeyDown: handleKeyDown,
                  ref: (el: HTMLInputElement) => {
                    _replaceInputRef = el;
                  },
                }),

                // Replace buttons
                jsx('button', {
                  class: 'search-panel-button',
                  title: 'Replace',
                  onClick: handleReplace,
                  disabled: matches.total === 0,
                  children: 'Replace',
                }),

                jsx('button', {
                  class: 'search-panel-button',
                  title: 'Replace all',
                  onClick: handleReplaceAll,
                  disabled: matches.total === 0,
                  children: 'Replace All',
                }),
              ],
            })
          : null,
      ],
    });
  };
}, 'SearchPanel');
