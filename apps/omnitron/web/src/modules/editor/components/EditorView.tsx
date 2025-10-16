import { defineComponent, signal, onMount } from '@omnitron-dev/aether';
import { Show, For } from '@omnitron-dev/aether/control-flow';
import { inject } from '@omnitron-dev/aether/di';
import { FileService } from '../services/file.service';
import { FileTree } from './FileTree';

/**
 * Editor View Component
 *
 * Main view component for the Editor module.
 * Provides a multi-file code editor with syntax highlighting.
 *
 * Features:
 * - File tree sidebar with hierarchical structure
 * - Multi-file editing with tabs
 * - Syntax highlighting
 * - File management
 * - Editor toolbar
 */
export default defineComponent(() => {
  const fileService = inject(FileService);

  const loading = signal(true);
  const editorContent = signal('');
  const sidebarVisible = signal(true);

  onMount(() => {
    // Load sample files
    fileService.loadSampleFiles();
    loading.set(false);

    // Set initial content if there's an active file
    const activeFile = fileService.getActiveFile();
    if (activeFile) {
      editorContent.set(activeFile.content);
    }
  });

  const selectFile = (id: string) => {
    fileService.setActiveFile(id);
    const file = fileService.getFile(id);
    if (file) {
      editorContent.set(file.content);
    }
  };

  const saveFile = () => {
    const activeFileId = fileService.getActiveFileId();
    if (activeFileId) {
      fileService.updateFileContent(activeFileId, editorContent());
      fileService.saveFile(activeFileId);
      console.log('File saved');
    }
  };

  const createNewFile = (parentPath?: string) => {
    const fileName = prompt('Enter file name:');
    if (fileName) {
      // Detect language from extension
      const ext = fileName.split('.').pop()?.toLowerCase();
      const languageMap: Record<string, string> = {
        ts: 'typescript',
        tsx: 'tsx',
        js: 'javascript',
        jsx: 'jsx',
        css: 'css',
        html: 'html',
        json: 'json',
        md: 'markdown',
      };
      const language = languageMap[ext || ''] || 'plaintext';

      fileService.createFile(fileName, language, '', parentPath);
    }
  };

  const renameFile = (fileId: string) => {
    const file = fileService.getFile(fileId);
    if (file) {
      const newName = prompt('Enter new name:', file.name);
      if (newName && newName !== file.name) {
        fileService.renameFile(fileId, newName);
      }
    }
  };

  const deleteFile = (fileId: string) => {
    const file = fileService.getFile(fileId);
    if (file && confirm(`Are you sure you want to delete ${file.name}?`)) {
      fileService.deleteFile(fileId);
    }
  };

  const toggleSidebar = () => {
    sidebarVisible.update((v) => !v);
  };

  return () => {
    const files = fileService.getFiles();
    const activeFileId = fileService.getActiveFileId();

    return (
      <div class="view editor-view">
        <div class="view-header">
          <h2>Code Editor</h2>
          <div class="editor-actions">
            <button class="button" onClick={toggleSidebar} title="Toggle Sidebar">
              {() => (sidebarVisible() ? '◀' : '▶')} Files
            </button>
            <button class="primary-button" onClick={() => createNewFile()}>
              + New File
            </button>
            <button class="button" onClick={saveFile} disabled={() => !activeFileId}>
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
            <div class="editor-layout">
              {/* File tree sidebar */}
              <Show when={() => sidebarVisible()}>
                <div class="editor-sidebar">
                  <FileTree
                    onFileSelect={selectFile}
                    onFileCreate={createNewFile}
                    onFileRename={renameFile}
                    onFileDelete={deleteFile}
                  />
                </div>
              </Show>

              {/* Main editor area */}
              <div class="editor-main">
                {/* File tabs */}
                <Show when={() => files.length > 0}>
                  <div class="file-tabs">
                    <For each={() => files}>
                      {(file) => (
                        <div
                          class={() => `file-tab ${activeFileId === file().id ? 'active' : ''}`}
                          onClick={() => selectFile(file().id)}
                        >
                          <span class="file-icon">📄</span>
                          <span class="file-name">{file().name}</span>
                          <Show when={() => file().isDirty}>
                            <span class="dirty-indicator">●</span>
                          </Show>
                          <button
                            class="close-tab"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteFile(file().id);
                            }}
                            title="Close file"
                          >
                            ×
                          </button>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>

                {/* Editor workspace */}
                <div class="editor-workspace">
                  <Show
                    when={() => activeFileId}
                    fallback={
                      <div class="editor-placeholder">
                        <h3>No file selected</h3>
                        <p>Open a file from the sidebar or create a new one</p>
                        <button class="primary-button" onClick={() => createNewFile()}>
                          Create New File
                        </button>
                      </div>
                    }
                  >
                    <div class="code-editor">
                      <div class="editor-toolbar">
                        <span class="file-path">
                          {() => {
                            const file = fileService.getActiveFile();
                            return file ? `${file.path} (${file.language})` : '';
                          }}
                        </span>
                        <div class="editor-tools">
                          <button class="tool-button" title="Format Document">
                            ⚡
                          </button>
                          <button class="tool-button" title="Find">
                            🔍
                          </button>
                          <button class="tool-button" title="Replace">
                            🔄
                          </button>
                          <button class="tool-button" title="Settings">
                            ⚙️
                          </button>
                        </div>
                      </div>
                      <div class="editor-content">
                        <textarea
                          class="code-textarea"
                          value={editorContent()}
                          onInput={(e) => {
                            const newContent = e.currentTarget.value;
                            editorContent.set(newContent);
                            const currentFileId = fileService.getActiveFileId();
                            if (currentFileId) {
                              fileService.updateFileContent(currentFileId, newContent);
                            }
                          }}
                          placeholder="Start typing..."
                          spellcheck={false}
                        />
                        <div class="editor-status">
                          <span>Lines: {() => editorContent().split('\n').length}</span>
                          <span>Characters: {() => editorContent().length}</span>
                          <span>UTF-8</span>
                          <Show when={() => fileService.getActiveFile()?.isDirty}>
                            <span class="unsaved-indicator">● Unsaved changes</span>
                          </Show>
                        </div>
                      </div>
                    </div>
                  </Show>
                </div>
              </div>
            </div>
          </Show>
        </div>
      </div>
    );
  };
});
