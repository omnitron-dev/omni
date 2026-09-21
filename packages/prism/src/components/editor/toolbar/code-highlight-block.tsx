import type { ReactNodeViewProps } from '@tiptap/react';

import { useCallback } from 'react';
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';

import { editorClasses } from '../classes.js';
import { DEFAULT_EDITOR_LABELS } from '../types.js';

export function CodeHighlightBlock(props: ReactNodeViewProps) {
  const { node, extension, updateAttributes } = props;
  const language = node.attrs.language;
  const lowlight = extension.options.lowlight;
  // A node view is rendered by the extension, not by the toolbar, so the
  // label reaches it through the extension's options — the same door the
  // lowlight instance comes through. The default keeps the previous word for
  // anyone configuring the extension directly.
  const autoLabel: string = extension.options.autoLanguageLabel ?? DEFAULT_EDITOR_LABELS.codeLanguageAuto;

  const handleChangeLanguage = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      updateAttributes({ language: event.target.value });
    },
    [updateAttributes]
  );

  return (
    <NodeViewWrapper className={editorClasses.content.codeBlock}>
      <select
        name="language"
        contentEditable={false}
        value={language || 'null'}
        onChange={handleChangeLanguage}
        className={editorClasses.content.langSelect}
      >
        <option value="null">{autoLabel}</option>
        <option disabled>—</option>
        {lowlight.listLanguages().map((lang: string) => (
          <option key={lang} value={lang}>
            {lang}
          </option>
        ))}
      </select>
      <pre>
        <NodeViewContent<'code'> as="code" />
      </pre>
    </NodeViewWrapper>
  );
}
