import type { EditorProps } from './types.js';

import { useMemo, useState, useEffect, useCallback } from 'react';
import { common, createLowlight } from 'lowlight';
import StarterKitExtension from '@tiptap/starter-kit';
import UnderlineExtension from '@tiptap/extension-underline';
import TextAlignExtension from '@tiptap/extension-text-align';
import ImageExtension from '@tiptap/extension-image';
import LinkExtension from '@tiptap/extension-link';
import PlaceholderExtension from '@tiptap/extension-placeholder';
import TaskListExtension from '@tiptap/extension-task-list';
import TaskItemExtension from '@tiptap/extension-task-item';
import CodeBlockLowlightExtension from '@tiptap/extension-code-block-lowlight';
import { useEditor, EditorContent, ReactNodeViewRenderer } from '@tiptap/react';

import Box from '@mui/material/Box';
import Portal from '@mui/material/Portal';
import Backdrop from '@mui/material/Backdrop';
import FormHelperText from '@mui/material/FormHelperText';

import { editorClasses } from './classes.js';
import { EditorRoot } from './styles.js';
import { resolveToolbar } from './presets.js';
import { Toolbar } from './toolbar/toolbar.js';
import { BubbleToolbar } from './toolbar/bubble-toolbar.js';
import { CodeHighlightBlock } from './toolbar/code-highlight-block.js';
import { ClearFormat } from './extensions/clear-format.js';
import { TextTransform } from './extensions/text-transform.js';

/**
 * PrismEditor — configurable rich text editor built on TipTap.
 *
 * Use `toolbar` prop to select a preset or provide custom toolbar items:
 * - `"full"` — CMS pages, blog articles (all features)
 * - `"standard"` — blog posts, forums (default)
 * - `"compact"` — comments, replies
 * - `"minimal"` — short feedback
 * - `"chat"` — messaging
 * - `"inline"` — no toolbar (titles, captions)
 * - `{ items: [...], bubbleMenu: true }` — custom
 */
export function Editor({
  sx,
  error,
  onChange,
  slotProps,
  helperText,
  resetValue,
  className,
  toolbar: toolbarConfig,
  bubbleMenu: bubbleMenuProp,
  format = 'json',
  minHeight = 160,
  maxHeight,
  editable = true,
  extraExtensions,
  placeholder = 'Write something...',
  ref: contentRef,
  value: initialContent = '',
  ...other
}: EditorProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const [rerenderKey, setRerenderKey] = useState(0);

  const resolvedToolbar = useMemo(() => resolveToolbar(toolbarConfig), [toolbarConfig]);
  const showBubbleMenu = bubbleMenuProp ?? resolvedToolbar.bubbleMenu;
  const showToolbar = resolvedToolbar.items.size > 0;

  const lowlight = useMemo(() => createLowlight(common), []);

  // Parse initial content — if format is 'json' and value looks like JSON, parse it
  const parsedContent = useMemo(() => {
    if (!initialContent) return '';
    if (format === 'json' && initialContent.startsWith('{')) {
      try {
        return JSON.parse(initialContent);
      } catch {
        return initialContent;
      }
    }
    return initialContent;
  }, [initialContent, format]);

  const debouncedOnChange = useMemo(() => {
    let timer: ReturnType<typeof setTimeout>;
    return (editor: any) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (format === 'json') {
          onChange?.(JSON.stringify(editor.getJSON()));
        } else {
          onChange?.(editor.getHTML());
        }
      }, 200);
    };
  }, [onChange, format]);

  const extensions = useMemo(() => {
    const has = (item: string) => resolvedToolbar.items.has(item as any);
    const exts: any[] = [
      StarterKitExtension.configure({
        codeBlock: false,
        // Underline and Link are registered separately (below) to allow per-preset control
        underline: false,
        link: false,
        code: has('code') ? { HTMLAttributes: { class: editorClasses.content.codeInline } } : false,
        heading: has('heading') ? { HTMLAttributes: { class: editorClasses.content.heading } } : false,
        horizontalRule: has('horizontalRule') ? { HTMLAttributes: { class: editorClasses.content.hr } } : false,
        listItem: { HTMLAttributes: { class: editorClasses.content.listItem } },
        blockquote: has('blockquote') ? { HTMLAttributes: { class: editorClasses.content.blockquote } } : false,
        bulletList: has('bulletList') ? { HTMLAttributes: { class: editorClasses.content.bulletList } } : false,
        orderedList: has('orderedList') ? { HTMLAttributes: { class: editorClasses.content.orderedList } } : false,
      }),
      PlaceholderExtension.configure({
        placeholder,
        emptyEditorClass: editorClasses.content.placeholder,
      }),
      ClearFormat,
      TextTransform,
    ];

    if (has('underline')) {
      exts.push(UnderlineExtension);
    }

    if (has('alignLeft') || has('alignCenter') || has('alignRight') || has('alignJustify')) {
      exts.push(TextAlignExtension.configure({ types: ['heading', 'paragraph'] }));
    }

    if (has('image')) {
      exts.push(ImageExtension.configure({ HTMLAttributes: { class: editorClasses.content.image } }));
    }

    if (has('link')) {
      exts.push(
        LinkExtension.configure({
          openOnClick: false,
          HTMLAttributes: { class: editorClasses.content.link },
        })
      );
    }

    if (has('codeBlock')) {
      exts.push(
        CodeBlockLowlightExtension.extend({
          addNodeView: () => ReactNodeViewRenderer(CodeHighlightBlock),
        }).configure({ lowlight })
      );
    }

    if (has('taskList')) {
      exts.push(
        TaskListExtension.configure({ HTMLAttributes: { class: editorClasses.content.taskList } }),
        TaskItemExtension.configure({
          nested: true,
          HTMLAttributes: { class: editorClasses.content.taskItem },
        })
      );
    }

    if (extraExtensions) {
      exts.push(...extraExtensions);
    }

    return exts;
  }, [resolvedToolbar, placeholder, lowlight, extraExtensions]);

  const editor = useEditor({
    editable,
    immediatelyRender: false,
    content: parsedContent,
    shouldRerenderOnTransaction: !!rerenderKey,
    onUpdate: (ctx) => {
      debouncedOnChange(ctx.editor);
    },
    extensions,
    ...other,
  });

  // Fullscreen handlers
  const handleToggleFullscreen = useCallback(() => {
    editor?.unmount();
    setFullscreen((prev) => !prev);
    setRerenderKey((prev) => prev + 1);
  }, [editor]);

  const handleExitFullscreen = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        editor?.unmount();
        setFullscreen(false);
        setRerenderKey((prev) => prev + 1);
      }
    },
    [editor]
  );

  // Sync content from outside
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!editor?.isDestroyed && editor?.isEmpty && parsedContent && parsedContent !== '<p></p>') {
        editor?.commands.setContent(parsedContent);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [parsedContent, editor]);

  // Reset support
  useEffect(() => {
    if (resetValue && !initialContent) {
      editor?.commands.clearContent();
    }
  }, [initialContent, resetValue, editor]);

  // Fullscreen ESC listener
  useEffect(() => {
    if (!fullscreen) return undefined;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleExitFullscreen);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleExitFullscreen);
    };
  }, [fullscreen, handleExitFullscreen]);

  const rootClassName = [
    editorClasses.root,
    className,
    error && editorClasses.state.error,
    !editable && editorClasses.state.disabled,
    fullscreen && editorClasses.state.fullscreen,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Portal disablePortal={!fullscreen}>
      {fullscreen && <Backdrop open sx={(theme) => ({ zIndex: theme.zIndex.modal - 1 })} />}

      <Box
        {...slotProps?.wrapper}
        sx={[
          { display: 'flex', flexDirection: 'column' },
          ...(Array.isArray(slotProps?.wrapper?.sx) ? slotProps.wrapper.sx : [slotProps?.wrapper?.sx]),
        ]}
      >
        <EditorRoot className={rootClassName} sx={[{ minHeight }, ...(Array.isArray(sx) ? sx : [sx])]}>
          {editor && !editor.isDestroyed && (
            <>
              {showToolbar && (
                <Toolbar
                  editor={editor}
                  toolbar={resolvedToolbar}
                  fullscreen={fullscreen}
                  onToggleFullscreen={handleToggleFullscreen}
                />
              )}
              {showBubbleMenu && <BubbleToolbar editor={editor} />}
              <EditorContent
                ref={contentRef}
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="off"
                editor={editor}
                className={editorClasses.content.root}
                style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}
              />
            </>
          )}
        </EditorRoot>

        {helperText && <FormHelperText error={!!error}>{helperText}</FormHelperText>}
      </Box>
    </Portal>
  );
}
