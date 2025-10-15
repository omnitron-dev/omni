/**
 * Editor View
 *
 * Code editor view using the EditorModule
 * Multi-file code editor with syntax highlighting (Monaco integration planned)
 */

import { defineComponent, signal, onMount } from '@omnitron-dev/aether';
import { Show, For } from '@omnitron-dev/aether/control-flow';
import { inject } from '@omnitron-dev/aether/di';
import { FileService, EditorService } from '../modules/editor';
import { FileTab } from '../modules/editor/components/FileTab';
import { EditorToolbar } from '../modules/editor/components/EditorToolbar';

/**
 * EditorView - Main editor view component
 */
export default defineComponent(() => {
  const fileService = inject(FileService);
  const editorService = inject(EditorService);

  const loading = signal(true);
  const editorContent = signal('');

  onMount(async () => {
    await editorService.initialize();
    loading.set(false);

    // Set initial content if there's an active file
    const activeFile = fileService.getActiveFile();
    if (activeFile) {
      editorContent.set(activeFile.content);
    }
  });

  const handleContentChange = (e: Event) => {
    const target = e.currentTarget as HTMLTextAreaElement;
    const newContent = target.value;
    editorContent.set(newContent);

    const activeFile = fileService.getActiveFile();
    if (activeFile) {
      fileService.updateFileContent(activeFile.id, newContent);
    }
  };

  const handleFileSelect = (id: string) => {
    fileService.setActiveFile(id);
    const file = fileService.getFile(id);
    if (file) {
      editorContent.set(file.content);
    }
  };

  const handleFileClose = (id: string) => {
    fileService.deleteFile(id);

    // Update content if the closed file was active
    const activeFile = fileService.getActiveFile();
    if (activeFile) {
      editorContent.set(activeFile.content);
    } else {
      editorContent.set('');
    }
  };

  const handleCreateFile = () => {
    const newFile = fileService.createFile();
    editorContent.set(newFile.content);
  };

  const handleSave = () => {
    editorService.saveActiveFile();
  };

  return () => {
    const files = fileService.getFiles();
    const activeFile = fileService.getActiveFile();
    const activeFileId = fileService.getActiveFileId();

    return (
      <div class="view editor-view">
        <div class="view-header">
          <h2>Code Editor</h2>
          <div class="editor-actions">
            <button class="primary-button" onClick={handleCreateFile}>
              + New File
            </button>
            <button class="button" onClick={handleSave} disabled={() => !activeFile}>
              💾 Save
            </button>
          </div>
        </div>

        <div class="view-content">
          <Show
            when={() => !loading()}
            fallback={
              <div class="loading-container">
                <div class="loading-spinner" />
                <p>Loading editor...</p>
              </div>
            }
          >
            <div class="editor-container">
              <div class="file-tabs">
                <For each={() => files}>
                  {(file) => (
                    <FileTab
                      file={file()}
                      isActive={activeFileId === file().id}
                      onSelect={handleFileSelect}
                      onClose={handleFileClose}
                    />
                  )}
                </For>
              </div>

              <div class="editor-workspace">
                <Show
                  when={() => activeFile}
                  fallback={
                    <div class="editor-placeholder">
                      <h3>No file selected</h3>
                      <p>Open a file from the sidebar or create a new one</p>
                      <button class="primary-button" onClick={handleCreateFile}>
                        Create New File
                      </button>
                    </div>
                  }
                >
                  <div class="code-editor">
                    <EditorToolbar />
                    <div class="editor-content">
                      <textarea
                        class="code-textarea"
                        value={editorContent()}
                        onInput={handleContentChange}
                        placeholder="Start typing..."
                        spellcheck={false}
                      />
                      <div class="editor-status">
                        <span>Lines: {() => editorService.getLineCount()}</span>
                        <span>Characters: {() => editorService.getCharacterCount()}</span>
                        <span>UTF-8</span>
                        <Show when={() => activeFile?.isDirty}>
                          <span class="unsaved-indicator">● Unsaved changes</span>
                        </Show>
                      </div>
                    </div>
                  </div>
                </Show>
              </div>
            </div>
          </Show>
        </div>
      </div>
    );
  };
});
