import type { Editor } from '@tiptap/react';
import type { EditorToolbarItemProps } from '../types.js';

import { useState, useCallback } from 'react';

import Button from '@mui/material/Button';
import Popover from '@mui/material/Popover';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { editorClasses } from '../classes.js';
import { ToolbarItem } from './toolbar-item.js';

interface ImageBlockProps {
  editor: Editor;
  icon: EditorToolbarItemProps['icon'];
}

export function ImageBlock({ editor, icon }: ImageBlockProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);
  const [state, setState] = useState({ imageUrl: '', altText: '' });

  const handleOpen = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  }, []);

  const handleClose = useCallback(() => {
    setAnchorEl(null);
  }, []);

  const handleApply = useCallback(() => {
    handleClose();
    setState({ imageUrl: '', altText: '' });
    editor.chain().focus().setImage({ src: state.imageUrl, alt: state.altText }).run();
  }, [editor, handleClose, state]);

  const popoverId = open ? 'image-popover' : undefined;

  return (
    <>
      <ToolbarItem
        aria-describedby={popoverId}
        aria-label="Insert image"
        className={editorClasses.toolbar.image}
        onClick={handleOpen}
        icon={icon}
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
        <Typography variant="subtitle2">Add image</Typography>
        <TextField
          fullWidth
          size="small"
          placeholder="Image URL"
          value={state.imageUrl}
          onChange={(e) => setState((prev) => ({ ...prev, imageUrl: e.target.value }))}
        />
        <TextField
          fullWidth
          size="small"
          placeholder="Alt text"
          value={state.altText}
          onChange={(e) => setState((prev) => ({ ...prev, altText: e.target.value }))}
        />
        <Button variant="contained" disabled={!state.imageUrl} onClick={handleApply} sx={{ alignSelf: 'flex-end' }}>
          Apply
        </Button>
      </Popover>
    </>
  );
}
