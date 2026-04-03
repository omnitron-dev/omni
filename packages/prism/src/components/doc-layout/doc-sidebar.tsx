'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Collapse from '@mui/material/Collapse';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';

export interface DocSidebarItem {
  id: string;
  label: string;
  href?: string;
  children?: DocSidebarItem[];
}

interface DocSidebarProps {
  items: DocSidebarItem[];
  activeId?: string;
  onItemClick?: (item: DocSidebarItem) => void;
  title?: string;
}

export function DocSidebar({ items, activeId, onItemClick, title }: DocSidebarProps) {
  return (
    <Box>
      {title && (
        <Typography
          variant="subtitle2"
          sx={{
            px: 1.5,
            pt: 0.5,
            pb: 2,
            fontWeight: 700,
            fontSize: '0.8125rem',
            color: 'text.secondary',
            letterSpacing: '0.01em',
          }}
        >
          {title}
        </Typography>
      )}
      <List dense disablePadding>
        {items.map((item) => (
          <SidebarNode key={item.id} item={item} activeId={activeId} onItemClick={onItemClick} depth={0} />
        ))}
      </List>
    </Box>
  );
}

function SidebarNode({
  item,
  activeId,
  onItemClick,
  depth,
}: {
  item: DocSidebarItem;
  activeId?: string;
  onItemClick?: (item: DocSidebarItem) => void;
  depth: number;
}) {
  const hasChildren = item.children && item.children.length > 0;
  const isActive = activeId === item.id;
  const [open, setOpen] = useState(true);
  const isCategory = hasChildren && !item.href;

  return (
    <>
      <ListItemButton
        selected={isActive}
        onClick={() => {
          if (hasChildren) setOpen(!open);
          onItemClick?.(item);
        }}
        sx={{
          pl: 1.5 + depth * 1.5,
          pr: 1,
          py: isCategory ? 0.75 : 0.5,
          borderRadius: 1,
          mx: 0.5,
          mb: 0.25,
          minHeight: 0,
          ...(isCategory && {
            mt: depth === 0 ? 1 : 0.5,
          }),
          ...(isActive && {
            bgcolor: (theme) => alpha(theme.palette.primary.main, 0.08),
            color: 'primary.main',
          }),
        }}
      >
        <ListItemText
          primary={item.label}
          primaryTypographyProps={{
            variant: 'body2',
            fontWeight: isCategory ? 600 : isActive ? 600 : 400,
            fontSize: isCategory ? '0.8125rem' : '0.8125rem',
            noWrap: true,
            ...(isCategory && {
              color: 'text.primary',
            }),
          }}
        />
      </ListItemButton>

      {hasChildren && (
        <Collapse in={open}>
          <List dense disablePadding>
            {item.children!.map((child) => (
              <SidebarNode
                key={child.id}
                item={child}
                activeId={activeId}
                onItemClick={onItemClick}
                depth={depth + 1}
              />
            ))}
          </List>
        </Collapse>
      )}
    </>
  );
}
