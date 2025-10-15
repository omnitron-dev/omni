import { defineComponent, signal, onMount } from '@omnitron-dev/aether';
import { Show, For } from '@omnitron-dev/aether/control-flow';

/**
 * Code Editor View
 *
 * Multi-file code editor with syntax highlighting and IntelliSense
 */
export default defineComponent(() => {
  const files = signal<Array<{ id: string; name: string; language: string; content: string }>>([]);
  const activeFile = signal<string | null>(null);
  const loading = signal(true);
  const editorContent = signal('');

  onMount(() => {
    // Simulate loading files
    setTimeout(() => {
      const sampleFiles = [
        { id: '1', name: 'index.ts', language: 'typescript', content: 'export default function main() {\n  console.log("Hello, Omnitron!");\n}' },
        { id: '2', name: 'App.tsx', language: 'tsx', content: 'import { defineComponent } from "@aether";\n\nexport const App = defineComponent(() => {\n  return () => <div>App</div>;\n});' },
        { id: '3', name: 'styles.css', language: 'css', content: '.container {\n  display: flex;\n  gap: 1rem;\n}' },
      ];
      files.set(sampleFiles);
      loading.set(false);

      if (sampleFiles.length > 0) {
        selectFile(sampleFiles[0].id);
      }
    }, 500);
  });

  const selectFile = (id: string) => {
    const file = files().find(f => f.id === id);
    if (file) {
      activeFile.set(id);
      editorContent.set(file.content);
    }
  };

  const saveFile = () => {
    const file = files().find(f => f.id === activeFile());
    if (file) {
      // Update file content
      files.update(fs =>
        fs.map(f => f.id === file.id ? { ...f, content: editorContent() } : f)
      );
      console.log(`Saved ${file.name}`);
    }
  };

  const createNewFile = () => {
    const newFile = {
      id: Date.now().toString(),
      name: `untitled-${files().length + 1}.txt`,
      language: 'plaintext',
      content: '',
    };
    files.update(f => [...f, newFile]);
    selectFile(newFile.id);
  };

  return () => (
    <div class="view editor-view">
      <div class="view-header">
        <h2>Code Editor</h2>
        <div class="editor-actions">
          <button class="primary-button" onClick={createNewFile}>
            + New File
          </button>
          <button class="button" onClick={saveFile} disabled={() => !activeFile()}>
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
              <For each={files}>
                {(file) => (
                  <div
                    class={() => `file-tab ${activeFile() === file().id ? 'active' : ''}`}
                    onClick={() => selectFile(file().id)}
                  >
                    <span class="file-icon">📄</span>
                    <span class="file-name">{file().name}</span>
                    <button class="close-tab" onClick={(e) => {
                      e.stopPropagation();
                      files.update(fs => fs.filter(f => f.id !== file().id));
                      if (activeFile() === file().id) {
                        const remaining = files();
                        if (remaining.length > 0) {
                          selectFile(remaining[0].id);
                        } else {
                          activeFile.set(null);
                          editorContent.set('');
                        }
                      }
                    }}>×</button>
                  </div>
                )}
              </For>
            </div>

            <div class="editor-workspace">
              <Show
                when={() => activeFile()}
                fallback={
                  <div class="editor-placeholder">
                    <h3>No file selected</h3>
                    <p>Open a file from the sidebar or create a new one</p>
                    <button class="primary-button" onClick={createNewFile}>
                      Create New File
                    </button>
                  </div>
                }
              >
                <div class="code-editor">
                  <div class="editor-toolbar">
                    <span class="file-path">
                      {() => {
                        const file = files().find(f => f.id === activeFile());
                        return file ? `${file.name} (${file.language})` : '';
                      }}
                    </span>
                    <div class="editor-tools">
                      <button class="tool-button" title="Format Document">⚡</button>
                      <button class="tool-button" title="Find">🔍</button>
                      <button class="tool-button" title="Replace">🔄</button>
                      <button class="tool-button" title="Settings">⚙️</button>
                    </div>
                  </div>
                  <div class="editor-content">
                    <textarea
                      class="code-textarea"
                      value={editorContent()}
                      onInput={(e) => editorContent.set(e.currentTarget.value)}
                      placeholder="Start typing..."
                      spellcheck={false}
                    />
                    <div class="editor-status">
                      <span>Lines: {() => editorContent().split('\n').length}</span>
                      <span>Characters: {() => editorContent().length}</span>
                      <span>UTF-8</span>
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
});