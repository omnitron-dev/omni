import { defineComponent, computed } from '../../../core/index.js';
import { jsx } from '../../../jsxruntime/runtime.js';
import type { EditorInstance } from '../core/types.js';
import type { Signal } from '../../../core/index.js';

export interface ToolbarButtonProps {
  editor: Signal<EditorInstance | null>;
  icon: string;
  title: string;
  command: string;
  args?: any[];
  class?: string;
  isActive?: (editor: EditorInstance) => boolean;
  isDisabled?: (editor: EditorInstance) => boolean;
}

export const ToolbarButton = defineComponent<ToolbarButtonProps>((props) => {
  const isActive = computed(() => {
    const editor = props.editor();
    return editor && props.isActive ? props.isActive(editor) : false;
  });

  const isDisabled = computed(() => {
    const editor = props.editor();
    return editor && props.isDisabled ? props.isDisabled(editor) : false;
  });

  const handleClick = () => {
    const editor = props.editor();
    if (editor && editor.commands && !isDisabled()) {
      editor.commands.execute(props.command, ...(props.args || []));
    }
  };

  const buttonClasses = computed(() => {
    const classes = ['toolbar-button'];
    if (props.class) classes.push(props.class);
    if (isActive()) classes.push('active');
    if (isDisabled()) classes.push('disabled');
    return classes.join(' ');
  });

  return () =>
    jsx('button', {
      class: buttonClasses,
      title: props.title,
      onClick: handleClick,
      disabled: isDisabled,
      children: props.icon,
    }) as Node;
}, 'ToolbarButton');
