/**
 * Editor Module - Barrel Exports
 *
 * Central export file for the Editor module
 */

// Module definition
export { EditorModule } from './editor.module';

// Services
export { FileService, EditorService } from './editor.module';
export type { EditorFile, FileNode } from './services/file.service';
export type { EditorSettings } from './services/editor.service';

// Components
export { CodeEditor, FileTab, EditorToolbar } from './editor.module';
export { FileTree } from './components/FileTree';
export type { FileTabProps } from './components/FileTab';
export type { FileTreeProps } from './components/FileTree';

// Stores
export { useEditorStore } from './stores/editor.store';
export type { EditorState } from './stores/editor.store';
