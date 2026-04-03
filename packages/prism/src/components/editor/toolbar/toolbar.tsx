import type { EditorToolbarProps } from '../types.js';

import Divider from '@mui/material/Divider';
import { alpha, styled } from '@mui/material/styles';

import { editorClasses } from '../classes.js';
import { ToolbarItem } from './toolbar-item.js';
import { HeadingBlock } from './heading-block.js';
import { LinkBlock } from './link-block.js';
import { ImageBlock } from './image-block.js';
import { useToolbarState } from './use-toolbar-state.js';
import {
  BoldIcon,
  ItalicIcon,
  UnderlineIcon,
  StrikeIcon,
  InlineCodeIcon,
  BulletListIcon,
  OrderedListIcon,
  CheckListIcon,
  AlignLeftIcon,
  AlignCenterIcon,
  AlignRightIcon,
  AlignJustifyIcon,
  QuoteIcon,
  CodeBlockIcon,
  HorizontalRuleIcon,
  LinkIcon,
  UnlinkIcon,
  ImageIcon,
  HardBreakIcon,
  ClearMarksIcon,
  UndoIcon,
  RedoIcon,
  FullscreenIcon,
  ExitFullscreenIcon,
} from '../icons/index.js';

export function Toolbar({ editor, toolbar, fullscreen, onToggleFullscreen }: EditorToolbarProps) {
  const state = useToolbarState(editor);
  const has = (item: string) => toolbar.items.has(item as any);
  const chain = () => editor.chain().focus();

  const hasAnyInGroup = (...items: string[]) => items.some(has);

  return (
    <ToolbarRoot className={editorClasses.toolbar.root}>
      {/* Heading selector */}
      {has('heading') && (
        <>
          <HeadingBlock editor={editor} isActive={state.isTextLevel} />
          <ToolbarDivider />
        </>
      )}

      {/* Text styles */}
      {hasAnyInGroup('bold', 'italic', 'underline', 'strike', 'code') && (
        <>
          <ToolbarBlock>
            {has('bold') && (
              <ToolbarItem
                aria-label="Bold (⌘B)"
                active={state.isBold}
                className={editorClasses.toolbar.bold}
                onClick={() => chain().toggleBold().run()}
                icon={<BoldIcon />}
              />
            )}
            {has('italic') && (
              <ToolbarItem
                aria-label="Italic (⌘I)"
                active={state.isItalic}
                className={editorClasses.toolbar.italic}
                onClick={() => chain().toggleItalic().run()}
                icon={<ItalicIcon />}
              />
            )}
            {has('underline') && (
              <ToolbarItem
                aria-label="Underline (⌘U)"
                active={state.isUnderline}
                className={editorClasses.toolbar.underline}
                onClick={() => chain().toggleUnderline().run()}
                icon={<UnderlineIcon />}
              />
            )}
            {has('strike') && (
              <ToolbarItem
                aria-label="Strikethrough"
                active={state.isStrike}
                className={editorClasses.toolbar.strike}
                onClick={() => chain().toggleStrike().run()}
                icon={<StrikeIcon />}
              />
            )}
            {has('code') && (
              <ToolbarItem
                aria-label="Inline code (⌘E)"
                active={state.isCode}
                className={editorClasses.toolbar.code}
                onClick={() => chain().toggleCode().run()}
                icon={<InlineCodeIcon />}
              />
            )}
          </ToolbarBlock>
          <ToolbarDivider />
        </>
      )}

      {/* Lists */}
      {hasAnyInGroup('bulletList', 'orderedList', 'taskList') && (
        <>
          <ToolbarBlock>
            {has('bulletList') && (
              <ToolbarItem
                aria-label="Bullet list"
                active={state.isBulletList}
                className={editorClasses.toolbar.bulletList}
                onClick={() => chain().toggleBulletList().run()}
                icon={<BulletListIcon />}
              />
            )}
            {has('orderedList') && (
              <ToolbarItem
                aria-label="Ordered list"
                active={state.isOrderedList}
                className={editorClasses.toolbar.orderedList}
                onClick={() => chain().toggleOrderedList().run()}
                icon={<OrderedListIcon />}
              />
            )}
            {has('taskList') && (
              <ToolbarItem
                aria-label="Task list"
                active={state.isTaskList}
                className={editorClasses.toolbar.taskList}
                onClick={() => chain().toggleTaskList().run()}
                icon={<CheckListIcon />}
              />
            )}
          </ToolbarBlock>
          <ToolbarDivider />
        </>
      )}

      {/* Alignment */}
      {hasAnyInGroup('alignLeft', 'alignCenter', 'alignRight', 'alignJustify') && (
        <>
          <ToolbarBlock>
            {has('alignLeft') && (
              <ToolbarItem
                aria-label="Align left"
                active={state.isAlign('left')}
                className={editorClasses.toolbar.alignLeft}
                onClick={() => chain().setTextAlign('left').run()}
                icon={<AlignLeftIcon />}
              />
            )}
            {has('alignCenter') && (
              <ToolbarItem
                aria-label="Align center"
                active={state.isAlign('center')}
                className={editorClasses.toolbar.alignCenter}
                onClick={() => chain().setTextAlign('center').run()}
                icon={<AlignCenterIcon />}
              />
            )}
            {has('alignRight') && (
              <ToolbarItem
                aria-label="Align right"
                active={state.isAlign('right')}
                className={editorClasses.toolbar.alignRight}
                onClick={() => chain().setTextAlign('right').run()}
                icon={<AlignRightIcon />}
              />
            )}
            {has('alignJustify') && (
              <ToolbarItem
                aria-label="Align justify"
                active={state.isAlign('justify')}
                className={editorClasses.toolbar.alignJustify}
                onClick={() => chain().setTextAlign('justify').run()}
                icon={<AlignJustifyIcon />}
              />
            )}
          </ToolbarBlock>
          <ToolbarDivider />
        </>
      )}

      {/* Block elements */}
      {hasAnyInGroup('blockquote', 'codeBlock', 'horizontalRule') && (
        <>
          <ToolbarBlock>
            {has('blockquote') && (
              <ToolbarItem
                aria-label="Blockquote"
                active={state.isBlockquote}
                className={editorClasses.toolbar.blockquote}
                onClick={() => chain().toggleBlockquote().run()}
                icon={<QuoteIcon />}
              />
            )}
            {has('codeBlock') && (
              <ToolbarItem
                aria-label="Code block"
                active={state.isCodeBlock}
                className={editorClasses.toolbar.codeBlock}
                onClick={() => chain().toggleCodeBlock().run()}
                icon={<CodeBlockIcon />}
              />
            )}
            {has('horizontalRule') && (
              <ToolbarItem
                aria-label="Horizontal rule"
                className={editorClasses.toolbar.hr}
                onClick={() => chain().setHorizontalRule().run()}
                icon={<HorizontalRuleIcon />}
              />
            )}
          </ToolbarBlock>
          <ToolbarDivider />
        </>
      )}

      {/* Link & Image */}
      {hasAnyInGroup('link', 'image') && (
        <>
          <ToolbarBlock>
            {has('link') && (
              <LinkBlock editor={editor} active={state.isLink} linkIcon={<LinkIcon />} unlinkIcon={<UnlinkIcon />} />
            )}
            {has('image') && <ImageBlock editor={editor} icon={<ImageIcon />} />}
          </ToolbarBlock>
          <ToolbarDivider />
        </>
      )}

      {/* Utilities */}
      {hasAnyInGroup('hardBreak', 'clearFormat') && (
        <>
          <ToolbarBlock>
            {has('hardBreak') && (
              <ToolbarItem
                aria-label="Hard break"
                className={editorClasses.toolbar.hardBreak}
                onClick={() => chain().setHardBreak().run()}
                icon={<HardBreakIcon />}
              />
            )}
            {has('clearFormat') && (
              <ToolbarItem
                aria-label="Clear format (⌘⇧X)"
                className={editorClasses.toolbar.clear}
                onClick={() => chain().clearNodes().unsetAllMarks().run()}
                icon={<ClearMarksIcon />}
              />
            )}
          </ToolbarBlock>
          <ToolbarDivider />
        </>
      )}

      {/* Undo/Redo */}
      {hasAnyInGroup('undo', 'redo') && (
        <>
          <ToolbarBlock>
            {has('undo') && (
              <ToolbarItem
                aria-label="Undo (⌘Z)"
                disabled={!state.canUndo}
                className={editorClasses.toolbar.undo}
                onClick={() => chain().undo().run()}
                icon={<UndoIcon />}
              />
            )}
            {has('redo') && (
              <ToolbarItem
                aria-label="Redo (⌘⇧Z)"
                disabled={!state.canRedo}
                className={editorClasses.toolbar.redo}
                onClick={() => chain().redo().run()}
                icon={<RedoIcon />}
              />
            )}
          </ToolbarBlock>
          <ToolbarDivider />
        </>
      )}

      {/* Fullscreen */}
      {has('fullscreen') && (
        <ToolbarBlock>
          <ToolbarItem
            aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            active={fullscreen}
            className={editorClasses.toolbar.fullscreen}
            onClick={onToggleFullscreen}
            icon={fullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
          />
        </ToolbarBlock>
      )}
    </ToolbarRoot>
  );
}

// ---------------------------------------------------------------------------
// Styled
// ---------------------------------------------------------------------------

const ToolbarRoot = styled('div')(({ theme }) => ({
  flexWrap: 'wrap',
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: theme.spacing(1),
  padding: theme.spacing(1.25),
  borderTopLeftRadius: 'inherit',
  borderTopRightRadius: 'inherit',
  backgroundColor: theme.palette.background.paper,
  borderBottom: `solid 1px ${alpha(theme.palette.grey[500], 0.2)}`,
}));

const ToolbarBlock = styled('div')(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(0.5),
}));

function ToolbarDivider() {
  return <Divider orientation="vertical" flexItem sx={{ height: 16, my: 'auto' }} />;
}
