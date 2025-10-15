/**
 * Editor Service
 *
 * Manages editor state and operations
 */

import { Injectable, inject } from '@omnitron-dev/aether/di';
import { signal } from '@omnitron-dev/aether';
import { FileService } from './file.service';

export interface EditorSettings {
  fontSize: number;
  tabSize: number;
  theme: 'light' | 'dark';
  wordWrap: boolean;
  lineNumbers: boolean;
}

/**
 * Editor Service for managing editor state and operations
 */
@Injectable({ scope: 'module' })
export class EditorService {
  private fileService = inject(FileService);
  private settings = signal<EditorSettings>({
    fontSize: 14,
    tabSize: 2,
    theme: 'dark',
    wordWrap: true,
    lineNumbers: true,
  });

  /**
   * Get editor settings
   */
  getSettings(): EditorSettings {
    return this.settings();
  }

  /**
   * Update editor settings
   */
  updateSettings(updates: Partial<EditorSettings>): void {
    this.settings.update(current => ({ ...current, ...updates }));
    console.log('[EditorService] Updated settings:', updates);
  }

  /**
   * Format document (placeholder for future Monaco integration)
   */
  formatDocument(): void {
    const activeFile = this.fileService.getActiveFile();
    if (activeFile) {
      console.log('[EditorService] Formatting document:', activeFile.name);
      // TODO: Implement actual formatting when Monaco is integrated
    }
  }

  /**
   * Find in document
   */
  find(query: string): void {
    console.log('[EditorService] Find:', query);
    // TODO: Implement find functionality
  }

  /**
   * Replace in document
   */
  replace(find: string, replaceWith: string): void {
    console.log('[EditorService] Replace:', { find, replaceWith });
    // TODO: Implement replace functionality
  }

  /**
   * Get line count for active file
   */
  getLineCount(): number {
    const activeFile = this.fileService.getActiveFile();
    if (!activeFile) return 0;
    return activeFile.content.split('\n').length;
  }

  /**
   * Get character count for active file
   */
  getCharacterCount(): number {
    const activeFile = this.fileService.getActiveFile();
    if (!activeFile) return 0;
    return activeFile.content.length;
  }

  /**
   * Initialize editor with sample data
   */
  async initialize(): Promise<void> {
    console.log('[EditorService] Initializing editor...');

    // Simulate loading delay
    await new Promise(resolve => setTimeout(resolve, 500));

    // Load sample files
    this.fileService.loadSampleFiles();

    console.log('[EditorService] Editor initialized');
  }

  /**
   * Save active file
   */
  saveActiveFile(): void {
    const activeFile = this.fileService.getActiveFile();
    if (activeFile) {
      this.fileService.saveFile(activeFile.id);
    }
  }

  /**
   * Save all files
   */
  saveAllFiles(): void {
    const files = this.fileService.getFiles();
    files.forEach(file => {
      if (file.isDirty) {
        this.fileService.saveFile(file.id);
      }
    });
    console.log('[EditorService] Saved all files');
  }

  /**
   * Check if there are unsaved changes
   */
  hasUnsavedChanges(): boolean {
    return this.fileService.hasUnsavedChanges();
  }
}
