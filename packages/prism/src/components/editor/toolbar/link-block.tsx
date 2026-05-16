import type { Editor } from '@tiptap/react';
import type { EditorToolbarItemProps } from '../types.js';

import { useState, useCallback } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Popover from '@mui/material/Popover';
import TextField from '@mui/material/TextField';

import { editorClasses } from '../classes.js';
import { ToolbarItem } from './toolbar-item.js';

interface LinkBlockProps {
  editor: Editor;
  active: boolean;
  linkIcon: EditorToolbarItemProps['icon'];
  unlinkIcon: EditorToolbarItemProps['icon'];
}

export function LinkBlock({ editor, linkIcon, unlinkIcon, active }: LinkBlockProps) {
  const [linkUrl, setLinkUrl] = useState('');
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  const handleOpen = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const currentUrl = editor.getAttributes('link').href ?? '';
      setAnchorEl(event.currentTarget);
      setLinkUrl(currentUrl);
    },
    [editor]
  );

  const handleClose = useCallback(() => {
    setAnchorEl(null);
  }, []);

  const handleApply = useCallback(() => {
    handleClose();
    const chain = () => editor.chain().focus().extendMarkRange('link');
    if (linkUrl) {
      chain().setLink({ href: linkUrl }).run();
    } else {
      chain().unsetLink().run();
    }
  }, [editor, linkUrl, handleClose]);

  const popoverId = open ? 'link-popover' : undefined;

  return (
    <>
      <ToolbarItem
        aria-describedby={popoverId}
        aria-label="Insert link"
        active={active}
        className={editorClasses.toolbar.link}
        onClick={handleOpen}
        icon={linkIcon}
      />

      <ToolbarItem
        aria-label="Remove link"
        disabled={!active}
        className={editorClasses.toolbar.unlink}
        onClick={() => editor.chain().focus().unsetLink().run()}
        icon={unlinkIcon}
      />

      <Popover
        id={popoverId}
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: { p: 2.5, gap: 1.25, width: 1, maxWidth: 320, display: 'flex', flexDirection: 'column' },
          },
        }}
      >
        {/* Floating Material-Design label sits in the outline notch
            when the field is empty/focused and tucks above when filled
            — replaces the old `<Typography>` heading + bare-placeholder
            shape which left the outline notched without a label,
            producing a visible gap. */}
        <Box sx={{ gap: 1, display: 'flex', alignItems: 'center' }}>
          <TextField
            fullWidth
            size="small"
            label="Link URL"
            placeholder="https://"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleApply();
            }}
          />
          <Button variant="contained" disabled={!linkUrl} onClick={handleApply}>
            Apply
          </Button>
        </Box>
      </Popover>
    </>
  );
}
