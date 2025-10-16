/**
 * FileTab Component
 *
 * Individual file tab for the editor
 */

import { defineComponent } from '@omnitron-dev/aether';
import { Show } from '@omnitron-dev/aether/control-flow';
import type { EditorFile } from '../services/file.service';

export interface FileTabProps {
  file: EditorFile;
  isActive: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

/**
 * FileTab - Individual file tab component
 */
export const FileTab = defineComponent<FileTabProps>((props) => {
  const handleClick = () => {
    props.onSelect(props.file.id);
  };

  const handleClose = (e: MouseEvent) => {
    e.stopPropagation();
    props.onClose(props.file.id);
  };

  return () => (
    <div class={() => `file-tab ${props.isActive ? 'active' : ''}`} onClick={handleClick}>
      <span class="file-icon">📄</span>
      <span class="file-name">{props.file.name}</span>
      <Show when={() => props.file.isDirty}>
        <span class="dirty-indicator">●</span>
      </Show>
      <button class="close-tab" onClick={handleClose} title="Close file">
        ×
      </button>
    </div>
  );
});
