/**
 * Core Module - User Store
 *
 * User preferences and profile state management
 */

import { defineStore, signal, computed, readonly, persist } from '@omnitron-dev/aether/store';
import { inject } from '@omnitron-dev/aether/di';
import { StorageService } from '../services/storage.service';
import { STORAGE_KEYS, DEFAULT_USER_PREFERENCES } from '../constants';

/**
 * User preferences interface
 */
export interface UserPreferences {
  /**
   * Theme preference
   */
  theme: 'dark' | 'light' | 'auto';

  /**
   * Font size
   */
  fontSize: number;

  /**
   * Font family
   */
  fontFamily: string;

  /**
   * Line height
   */
  lineHeight: number;

  /**
   * Tab size
   */
  tabSize: number;

  /**
   * Auto save enabled
   */
  autoSave: boolean;

  /**
   * Auto save delay (ms)
   */
  autoSaveDelay: number;
}

/**
 * User state interface
 */
export interface UserState {
  /**
   * User ID (if authenticated)
   */
  userId: string | null;

  /**
   * Username
   */
  username: string | null;

  /**
   * User email
   */
  email: string | null;

  /**
   * Is user authenticated
   */
  isAuthenticated: boolean;

  /**
   * User preferences
   */
  preferences: UserPreferences;

  /**
   * Recent files
   */
  recentFiles: Array<{
    path: string;
    name: string;
    lastOpened: number;
  }>;

  /**
   * Workspace settings
   */
  workspace: {
    lastOpenedFolder: string | null;
    openFiles: string[];
    activeFile: string | null;
  };
}

/**
 * User Store
 *
 * Manages user profile and preferences with persistent storage.
 * Automatically saves preferences to localStorage.
 *
 * @example
 * ```typescript
 * const userStore = useUserStore();
 *
 * // Update preferences
 * userStore.updatePreferences({
 *   fontSize: 16,
 *   theme: 'dark'
 * });
 *
 * // Add recent file
 * userStore.addRecentFile('/path/to/file.ts', 'file.ts');
 *
 * // Set active file
 * userStore.setActiveFile('/path/to/file.ts');
 * ```
 */
export const useUserStore = defineStore('user', () => {
  // Get storage service
  const storage = inject(StorageService);

  // Load saved preferences
  const savedPreferences = storage.get<UserPreferences>(STORAGE_KEYS.USER_PREFERENCES);
  const initialPreferences = savedPreferences
    ? { ...DEFAULT_USER_PREFERENCES, ...savedPreferences }
    : { ...DEFAULT_USER_PREFERENCES };

  // State signals
  const userId = signal<string | null>(null);
  const username = signal<string | null>(null);
  const email = signal<string | null>(null);
  const isAuthenticated = signal(false);
  const preferences = signal<UserPreferences>(initialPreferences);
  const recentFiles = signal<
    Array<{
      path: string;
      name: string;
      lastOpened: number;
    }>
  >([]);
  const workspace = signal({
    lastOpenedFolder: null as string | null,
    openFiles: [] as string[],
    activeFile: null as string | null,
  });

  // Setup persistence for preferences
  persist(preferences, {
    key: STORAGE_KEYS.USER_PREFERENCES,
    storage: 'local',
  });

  // Computed values
  const state = computed(() => ({
    userId: userId(),
    username: username(),
    email: email(),
    isAuthenticated: isAuthenticated(),
    preferences: preferences(),
    recentFiles: recentFiles(),
    workspace: workspace(),
  }));

  // Actions

  /**
   * Update user preferences
   */
  const updatePreferences = (updates: Partial<UserPreferences>) => {
    preferences.set({
      ...preferences(),
      ...updates,
    });
  };

  /**
   * Reset preferences to defaults
   */
  const resetPreferences = () => {
    preferences.set({ ...DEFAULT_USER_PREFERENCES });
  };

  /**
   * Set user authentication
   */
  const setAuthentication = (id: string, name: string, userEmail: string) => {
    userId.set(id);
    username.set(name);
    email.set(userEmail);
    isAuthenticated.set(true);
  };

  /**
   * Clear user authentication
   */
  const clearAuthentication = () => {
    userId.set(null);
    username.set(null);
    email.set(null);
    isAuthenticated.set(false);
  };

  /**
   * Add recent file
   */
  const addRecentFile = (path: string, name: string) => {
    const files = [...recentFiles()];

    // Remove if already exists
    const existingIndex = files.findIndex((f) => f.path === path);
    if (existingIndex !== -1) {
      files.splice(existingIndex, 1);
    }

    // Add to beginning
    files.unshift({
      path,
      name,
      lastOpened: Date.now(),
    });

    // Keep only last 20
    if (files.length > 20) {
      files.pop();
    }

    recentFiles.set(files);
  };

  /**
   * Clear recent files
   */
  const clearRecentFiles = () => {
    recentFiles.set([]);
  };

  /**
   * Set last opened folder
   */
  const setLastOpenedFolder = (folder: string | null) => {
    workspace.set({
      ...workspace(),
      lastOpenedFolder: folder,
    });
  };

  /**
   * Add open file
   */
  const addOpenFile = (filePath: string) => {
    const currentWorkspace = workspace();
    const openFiles = [...currentWorkspace.openFiles];
    if (!openFiles.includes(filePath)) {
      openFiles.push(filePath);
      workspace.set({
        ...currentWorkspace,
        openFiles,
      });
    }
  };

  /**
   * Remove open file
   */
  const removeOpenFile = (filePath: string) => {
    const currentWorkspace = workspace();
    const openFiles = currentWorkspace.openFiles.filter((f) => f !== filePath);

    workspace.set({
      ...currentWorkspace,
      openFiles,
      // If active file was removed, set to null
      activeFile: currentWorkspace.activeFile === filePath ? null : currentWorkspace.activeFile,
    });
  };

  /**
   * Set active file
   */
  const setActiveFile = (filePath: string | null) => {
    workspace.set({
      ...workspace(),
      activeFile: filePath,
    });
  };

  /**
   * Clear workspace
   */
  const clearWorkspace = () => {
    workspace.set({
      lastOpenedFolder: null,
      openFiles: [],
      activeFile: null,
    });
  };

  return {
    // State (readonly)
    userId: readonly(userId),
    username: readonly(username),
    email: readonly(email),
    isAuthenticated: readonly(isAuthenticated),
    preferences: readonly(preferences),
    recentFiles: readonly(recentFiles),
    workspace: readonly(workspace),

    // Computed
    state,

    // Actions
    updatePreferences,
    resetPreferences,
    setAuthentication,
    clearAuthentication,
    addRecentFile,
    clearRecentFiles,
    setLastOpenedFolder,
    addOpenFile,
    removeOpenFile,
    setActiveFile,
    clearWorkspace,
  };
});
