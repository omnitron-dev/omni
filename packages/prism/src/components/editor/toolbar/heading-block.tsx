import type { Editor } from '@tiptap/react';
import type { TextHeadingLevel } from './use-toolbar-state.js';

import { useState, useCallback } from 'react';

import Menu from '@mui/material/Menu';
import { styled } from '@mui/material/styles';
import ButtonBase from '@mui/material/ButtonBase';
import { listClasses } from '@mui/material/List';
import { buttonBaseClasses } from '@mui/material/ButtonBase';

import { ToolbarItem } from './toolbar-item.js';
import { ParagraphIcon, H1Icon, H2Icon, H3Icon, H4Icon, H5Icon, H6Icon } from '../icons/index.js';

const HEADING_OPTIONS = [
  { key: 'Paragraph', level: null as TextHeadingLevel, icon: <ParagraphIcon sx={{ fontSize: 18 }} /> },
  { key: 'Heading 1', level: 1 as TextHeadingLevel, icon: <H1Icon sx={{ fontSize: 18 }} /> },
  { key: 'Heading 2', level: 2 as TextHeadingLevel, icon: <H2Icon sx={{ fontSize: 18 }} /> },
  { key: 'Heading 3', level: 3 as TextHeadingLevel, icon: <H3Icon sx={{ fontSize: 18 }} /> },
  { key: 'Heading 4', level: 4 as TextHeadingLevel, icon: <H4Icon sx={{ fontSize: 18 }} /> },
  { key: 'Heading 5', level: 5 as TextHeadingLevel, icon: <H5Icon sx={{ fontSize: 18 }} /> },
  { key: 'Heading 6', level: 6 as TextHeadingLevel, icon: <H6Icon sx={{ fontSize: 18 }} /> },
];

interface HeadingBlockProps {
  editor: Editor;
  isActive: (value: TextHeadingLevel) => boolean;
}

export function HeadingBlock({ editor, isActive }: HeadingBlockProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  const handleOpen = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  }, []);

  const handleClose = useCallback(() => {
    setAnchorEl(null);
  }, []);

  const handleSelect = useCallback(
    (value: TextHeadingLevel) => {
      handleClose();
      if (value) {
        editor.chain().focus().toggleHeading({ level: value }).run();
      } else {
        editor.chain().focus().setParagraph().run();
      }
    },
    [editor, handleClose]
  );

  const activeIcon = (editor.isActive('heading', { level: 1 }) && <H1Icon sx={{ fontSize: 18 }} />) ||
    (editor.isActive('heading', { level: 2 }) && <H2Icon sx={{ fontSize: 18 }} />) ||
    (editor.isActive('heading', { level: 3 }) && <H3Icon sx={{ fontSize: 18 }} />) ||
    (editor.isActive('heading', { level: 4 }) && <H4Icon sx={{ fontSize: 18 }} />) ||
    (editor.isActive('heading', { level: 5 }) && <H5Icon sx={{ fontSize: 18 }} />) ||
    (editor.isActive('heading', { level: 6 }) && <H6Icon sx={{ fontSize: 18 }} />) || (
      <ParagraphIcon sx={{ fontSize: 18 }} />
    );

  const buttonId = 'heading-menu-button';
  const menuId = 'heading-menu';

  return (
    <>
      <HeadingButton
        id={buttonId}
        aria-label="Heading menu"
        aria-controls={open ? menuId : undefined}
        aria-haspopup="true"
        aria-expanded={open ? 'true' : undefined}
        onClick={handleOpen}
      >
        {activeIcon}
      </HeadingButton>

      <Menu
        id={menuId}
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        slotProps={{
          list: { 'aria-labelledby': buttonId },
          paper: {
            sx: {
              width: 42,
              [`& .${listClasses.root}`]: { gap: 0.5, display: 'flex', flexDirection: 'column' },
              [`& .${buttonBaseClasses.root}`]: {
                px: 1,
                width: 1,
                height: 34,
                borderRadius: 0.75,
                justifyContent: 'flex-start',
                '&:hover': { backgroundColor: 'action.hover' },
              },
            },
          },
        }}
      >
        {HEADING_OPTIONS.map((option) => (
          <ToolbarItem
            key={option.key}
            component="li"
            aria-label={option.key}
            icon={option.icon}
            active={isActive(option.level)}
            onClick={() => handleSelect(option.level)}
          />
        ))}
      </Menu>
    </>
  );
}

const HeadingButton = styled(ButtonBase)(({ theme }) => ({
  width: 28,
  height: 28,
  borderRadius: Number(theme.shape.borderRadius) * 0.75,
  justifyContent: 'center',
  '&:hover': {
    backgroundColor: theme.palette.action.hover,
  },
}));
