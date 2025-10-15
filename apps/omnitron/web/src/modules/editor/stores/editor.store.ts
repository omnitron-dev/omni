/**
 * Editor Store
 *
 * Reactive state for the editor module
 */

import { defineStore, signal, computed, readonly } from '@omnitron-dev/aether/store';
import type { EditorFile } from '../services/file.service';

export interface EditorState {
  files: EditorFile[];
  activeFileId: string | null;
  loading: boolean;
  editorContent: string;
}

/**
 * Editor Store
 *
 * Manages editor state including open files, active file, and content.
 *
 * @example
 * ```typescript
 * const editorStore = useEditorStore();
 *
 * // Set active file
 * editorStore.setActiveFileId('file-1');
 *
 * // Update content
 * editorStore.setEditorContent('new content');
 *
 * // Add file
 * editorStore.addFile(newFile);
 * ```
 */
export const useEditorStore = defineStore('editor', () => {
  // State signals
  const files = signal<EditorFile[]>([]);
  const activeFileId = signal<string | null>(null);
  const loading = signal(true);
  const editorContent = signal('');

  // Computed values
  const activeFile = computed(() => {
    const id = activeFileId();
    if (!id) return null;
    return files().find((f) => f.id === id) || null;
  });

  const hasUnsavedChanges = computed(() => {
    const file = activeFile();
    if (!file) return false;
    return file.content !== editorContent();
  });

  const state = computed(() => ({
    files: files(),
    activeFileId: activeFileId(),
    loading: loading(),
    editorContent: editorContent(),
  }));

  // Actions

  /**
   * Set files
   */
  const setFiles = (newFiles: EditorFile[]) => {
    files.set(newFiles);
  };

  /**
   * Add file
   */
  const addFile = (file: EditorFile) => {
    files.set([...files(), file]);
  };

  /**
   * Remove file
   */
  const removeFile = (fileId: string) => {
    files.set(files().filter((f) => f.id !== fileId));
    if (activeFileId() === fileId) {
      activeFileId.set(null);
      editorContent.set('');
    }
  };

  /**
   * Update file
   */
  const updateFile = (fileId: string, updates: Partial<EditorFile>) => {
    files.set(files().map((f) => (f.id === fileId ? { ...f, ...updates } : f)));
  };

  /**
   * Set active file ID
   */
  const setActiveFileId = (fileId: string | null) => {
    activeFileId.set(fileId);
    if (fileId) {
      const file = files().find((f) => f.id === fileId);
      if (file) {
        editorContent.set(file.content);
      }
    } else {
      editorContent.set('');
    }
  };

  /**
   * Set loading state
   */
  const setLoading = (value: boolean) => {
    loading.set(value);
  };

  /**
   * Set editor content
   */
  const setEditorContent = (content: string) => {
    editorContent.set(content);
  };

  /**
   * Save current file
   */
  const saveCurrentFile = () => {
    const fileId = activeFileId();
    if (fileId) {
      updateFile(fileId, { content: editorContent() });
    }
  };

  /**
   * Discard changes
   */
  const discardChanges = () => {
    const file = activeFile();
    if (file) {
      editorContent.set(file.content);
    }
  };

  /**
   * Reset store
   */
  const reset = () => {
    files.set([]);
    activeFileId.set(null);
    loading.set(true);
    editorContent.set('');
  };

  return {
    // State (readonly)
    files: readonly(files),
    activeFileId: readonly(activeFileId),
    loading: readonly(loading),
    editorContent: readonly(editorContent),

    // Computed
    activeFile,
    hasUnsavedChanges,
    state,

    // Actions
    setFiles,
    addFile,
    removeFile,
    updateFile,
    setActiveFileId,
    setLoading,
    setEditorContent,
    saveCurrentFile,
    discardChanges,
    reset,
  };
});
