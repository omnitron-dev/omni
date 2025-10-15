/**
 * EditorToolbar Component
 *
 * Toolbar with editor actions and tools
 */

import { defineComponent } from '@omnitron-dev/aether';
import { inject } from '@omnitron-dev/aether/di';
import { EditorService } from '../services/editor.service';
import { FileService } from '../services/file.service';

/**
 * EditorToolbar - Toolbar component with editor actions
 */
export const EditorToolbar = defineComponent(() => {
  const editorService = inject(EditorService);
  const fileService = inject(FileService);

  const handleFormat = () => {
    editorService.formatDocument();
  };

  const handleFind = () => {
    const query = prompt('Find:');
    if (query) {
      editorService.find(query);
    }
  };

  const handleReplace = () => {
    const find = prompt('Find:');
    if (find) {
      const replaceWith = prompt('Replace with:');
      if (replaceWith !== null) {
        editorService.replace(find, replaceWith);
      }
    }
  };

  const handleSettings = () => {
    console.log('[EditorToolbar] Settings clicked');
    // TODO: Open settings modal
  };

  return () => {
    const activeFile = fileService.getActiveFile();

    return (
      <div class="editor-toolbar">
        <span class="file-path">
          {() => {
            if (!activeFile) return '';
            return `${activeFile.name} (${activeFile.language})`;
          }}
        </span>
        <div class="editor-tools">
          <button
            class="tool-button"
            title="Format Document"
            onClick={handleFormat}
            disabled={() => !activeFile}
          >
            ⚡
          </button>
          <button
            class="tool-button"
            title="Find"
            onClick={handleFind}
            disabled={() => !activeFile}
          >
            🔍
          </button>
          <button
            class="tool-button"
            title="Replace"
            onClick={handleReplace}
            disabled={() => !activeFile}
          >
            🔄
          </button>
          <button
            class="tool-button"
            title="Settings"
            onClick={handleSettings}
          >
            ⚙️
          </button>
        </div>
      </div>
    );
  };
});
