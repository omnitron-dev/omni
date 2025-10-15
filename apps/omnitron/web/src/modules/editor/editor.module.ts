/**
 * Editor Module
 *
 * Module definition for the Editor feature.
 * Provides code editing functionality with file management.
 */

import { defineModule } from '@omnitron-dev/aether/di';
import { FileService } from './services/file.service';
import { EditorService } from './services/editor.service';

/**
 * Editor Module Definition
 *
 * Provides code editing capabilities with:
 * - Multi-file editing with tabs
 * - Syntax highlighting
 * - File management
 * - Code formatting and tools
 */
export const EditorModule = defineModule({
  id: 'editor',
  version: '1.0.0',

  providers: [FileService, EditorService],

  stores: [() => import('./stores/editor.store')],

  routes: [
    {
      path: '/editor',
      component: () => import('./components/EditorView'),
      meta: { title: 'Code Editor - Omnitron' },
    },
  ],

  exportProviders: [EditorService],

  exportStores: ['editor'],

  metadata: {
    name: 'Editor Module',
    description: 'Code editor with file management',
    author: 'Omnitron Team',
  },

  optimization: {
    lazyBoundary: true,
    splitChunk: true,
  },
});

// Export services for direct use
export { FileService, EditorService };

// Export components
export { CodeEditor } from './components/CodeEditor';
export { FileTab } from './components/FileTab';
export { EditorToolbar } from './components/EditorToolbar';

// Export stores
export { editorStore } from './stores/editor.store';
export type { EditorState } from './stores/editor.store';

// Export types
export type { EditorFile } from './services/file.service';
export type { EditorSettings } from './services/editor.service';
export type { FileTabProps } from './components/FileTab';
