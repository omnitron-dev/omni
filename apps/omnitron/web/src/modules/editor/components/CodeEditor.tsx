/**
 * CodeEditor Component
 *
 * Main code editor component with textarea (Monaco integration planned)
 */

import { defineComponent, signal, onMount } from '@omnitron-dev/aether';
import { Show } from '@omnitron-dev/aether/control-flow';
import { inject } from '@omnitron-dev/aether/di';
import { FileService } from '../services/file.service';
import { EditorService } from '../services/editor.service';

/**
 * CodeEditor - Main editor component with file management
 */
export const CodeEditor = defineComponent(() => {
  const fileService = inject(FileService);
  const editorService = inject(EditorService);

  const editorContent = signal('');
  const loading = signal(true);

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

  return () => {
    const activeFile = fileService.getActiveFile();
    const activeFileId = fileService.getActiveFileId();

    return (
      <div class="code-editor-container">
        <Show
          when={() => !loading()}
          fallback={
            <div class="loading-container">
              <div class="loading-spinner" />
              <p>Loading editor...</p>
            </div>
          }
        >
          <Show
            when={() => activeFile}
            fallback={
              <div class="editor-placeholder">
                <h3>No file selected</h3>
                <p>Create a new file or select one from the file tabs</p>
              </div>
            }
          >
            <div class="code-editor-content">
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
          </Show>
        </Show>
      </div>
    );
  };
});
