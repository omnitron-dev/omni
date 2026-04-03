// ---------------------------------------------------------------------------
// Editor CSS class tokens
// ---------------------------------------------------------------------------

const cls = (name: string) => `prism-editor-${name}`;

export const editorClasses = {
  root: cls('root'),
  toolbar: {
    root: cls('toolbar'),
    hr: cls('toolbar-hr'),
    bold: cls('toolbar-bold'),
    italic: cls('toolbar-italic'),
    underline: cls('toolbar-underline'),
    strike: cls('toolbar-strike'),
    code: cls('toolbar-code'),
    codeBlock: cls('toolbar-code-block'),
    link: cls('toolbar-link'),
    unlink: cls('toolbar-unlink'),
    image: cls('toolbar-image'),
    alignLeft: cls('toolbar-align-left'),
    alignCenter: cls('toolbar-align-center'),
    alignRight: cls('toolbar-align-right'),
    alignJustify: cls('toolbar-align-justify'),
    bulletList: cls('toolbar-bullet-list'),
    orderedList: cls('toolbar-ordered-list'),
    taskList: cls('toolbar-task-list'),
    blockquote: cls('toolbar-blockquote'),
    hardBreak: cls('toolbar-hard-break'),
    clear: cls('toolbar-clear'),
    undo: cls('toolbar-undo'),
    redo: cls('toolbar-redo'),
    fullscreen: cls('toolbar-fullscreen'),
  },
  content: {
    root: cls('content'),
    hr: cls('content-hr'),
    link: cls('content-link'),
    image: cls('content-image'),
    heading: cls('content-heading'),
    codeInline: cls('content-code-inline'),
    codeBlock: cls('content-code-block'),
    langSelect: cls('content-lang-select'),
    blockquote: cls('content-blockquote'),
    bulletList: cls('content-bullet-list'),
    orderedList: cls('content-ordered-list'),
    listItem: cls('content-list-item'),
    taskList: cls('content-task-list'),
    taskItem: cls('content-task-item'),
    placeholder: cls('content-placeholder'),
  },
  state: {
    error: cls('state-error'),
    disabled: cls('state-disabled'),
    fullscreen: cls('state-fullscreen'),
  },
};
