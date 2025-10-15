/**
 * Settings Store
 *
 * Reactive state for settings module
 */

import { defineStore, signal, computed, readonly } from '@omnitron-dev/aether/store';

/**
 * Settings Store
 *
 * Manages settings UI state including active group, modification status, and search.
 *
 * @example
 * ```typescript
 * const settingsStore = useSettingsStore();
 *
 * // Set active group
 * settingsStore.setActiveGroup('appearance');
 *
 * // Mark as modified
 * settingsStore.markModified();
 *
 * // Search settings
 * settingsStore.setSearchQuery('theme');
 * ```
 */
export const useSettingsStore = defineStore('settings', () => {
  // UI state
  const activeGroup = signal('appearance');
  const isModified = signal(false);
  const isSaving = signal(false);

  // Search
  const searchQuery = signal('');

  // Computed values
  const hasChanges = computed(() => isModified());
  const canSave = computed(() => isModified() && !isSaving());

  const state = computed(() => ({
    activeGroup: activeGroup(),
    isModified: isModified(),
    isSaving: isSaving(),
    searchQuery: searchQuery(),
  }));

  // Actions

  /**
   * Set active group
   */
  const setActiveGroup = (groupId: string) => {
    activeGroup.set(groupId);
  };

  /**
   * Mark as modified
   */
  const markModified = () => {
    isModified.set(true);
  };

  /**
   * Mark as saved
   */
  const markSaved = () => {
    isModified.set(false);
  };

  /**
   * Set saving state
   */
  const setSaving = (saving: boolean) => {
    isSaving.set(saving);
  };

  /**
   * Set search query
   */
  const setSearchQuery = (query: string) => {
    searchQuery.set(query);
  };

  /**
   * Clear search
   */
  const clearSearch = () => {
    searchQuery.set('');
  };

  /**
   * Reset state
   */
  const reset = () => {
    activeGroup.set('appearance');
    isModified.set(false);
    isSaving.set(false);
    searchQuery.set('');
  };

  return {
    // State (readonly)
    activeGroup: readonly(activeGroup),
    isModified: readonly(isModified),
    isSaving: readonly(isSaving),
    searchQuery: readonly(searchQuery),

    // Computed
    hasChanges,
    canSave,
    state,

    // Actions
    setActiveGroup,
    markModified,
    markSaved,
    setSaving,
    setSearchQuery,
    clearSearch,
    reset,
  };
});
