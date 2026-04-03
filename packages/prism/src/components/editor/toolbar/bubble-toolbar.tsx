import type { Editor } from '@tiptap/react';

import { BubbleMenu } from '@tiptap/react/menus';
import Divider from '@mui/material/Divider';
import { alpha, styled } from '@mui/material/styles';

import { editorClasses } from '../classes.js';
import { ToolbarItem } from './toolbar-item.js';
import { LinkBlock } from './link-block.js';
import { useToolbarState } from './use-toolbar-state.js';
import {
  BoldIcon,
  ItalicIcon,
  UnderlineIcon,
  StrikeIcon,
  LinkIcon,
  UnlinkIcon,
  ClearMarksIcon,
} from '../icons/index.js';

interface BubbleToolbarProps {
  editor: Editor;
}

export function BubbleToolbar({ editor }: BubbleToolbarProps) {
  const state = useToolbarState(editor);
  const chain = () => editor.chain().focus();

  return (
    <BubbleMenu editor={editor}>
      <BubbleRoot>
        <ToolbarItem
          aria-label="Bold"
          active={state.isBold}
          className={editorClasses.toolbar.bold}
          onClick={() => chain().toggleBold().run()}
          icon={<BoldIcon />}
        />
        <ToolbarItem
          aria-label="Italic"
          active={state.isItalic}
          className={editorClasses.toolbar.italic}
          onClick={() => chain().toggleItalic().run()}
          icon={<ItalicIcon />}
        />
        <ToolbarItem
          aria-label="Underline"
          active={state.isUnderline}
          className={editorClasses.toolbar.underline}
          onClick={() => chain().toggleUnderline().run()}
          icon={<UnderlineIcon />}
        />
        <ToolbarItem
          aria-label="Strike"
          active={state.isStrike}
          className={editorClasses.toolbar.strike}
          onClick={() => chain().toggleStrike().run()}
          icon={<StrikeIcon />}
        />
        <LinkBlock editor={editor} active={state.isLink} linkIcon={<LinkIcon />} unlinkIcon={<UnlinkIcon />} />
        <Divider orientation="vertical" flexItem sx={{ height: 16, my: 'auto' }} />
        <ToolbarItem
          aria-label="Clear format"
          className={editorClasses.toolbar.clear}
          onClick={() => chain().clearNodes().unsetAllMarks().run()}
          icon={<ClearMarksIcon />}
        />
      </BubbleRoot>
    </BubbleMenu>
  );
}

const BubbleRoot = styled('div')(({ theme }) => ({
  display: 'flex',
  gap: theme.spacing(0.5),
  padding: theme.spacing(0.5),
  borderRadius: theme.shape.borderRadius,
  boxShadow: theme.shadows[8],
  backgroundColor: theme.palette.background.paper,
  border: `1px solid ${alpha(theme.palette.grey[500], 0.16)}`,
}));
