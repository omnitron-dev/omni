'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import Collapse from '@mui/material/Collapse';
import Tooltip from '@mui/material/Tooltip';
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

/**
 * Maximum number of lines a long sidebar label may wrap onto
 * before ellipsis kicks in. 2 is the industry baseline for
 * compact navigation surfaces (Notion / Linear / Stripe).
 *
 * Bumped to 3 would help Russian compound words like
 * "Универсальные категории" but would noticeably loosen the
 * vertical rhythm of the sidebar.
 */
const MAX_LABEL_LINES = 2;

// useLayoutEffect logs a warning during SSR; pick the right hook so
// consumers rendering the sidebar in a server bundle aren't noisy.
const useIsoLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

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
          alignItems: 'flex-start',
          ...(isCategory && {
            mt: depth === 0 ? 1 : 0.5,
          }),
          ...(isActive && {
            bgcolor: (theme) => alpha(theme.palette.primary.main, 0.08),
            color: 'primary.main',
          }),
        }}
      >
        <SidebarLabel
          label={item.label}
          sx={{
            fontWeight: isCategory ? 600 : isActive ? 600 : 400,
            fontSize: '0.8125rem',
            ...(isCategory && { color: 'text.primary' }),
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

/**
 * Label cell with industry-standard "wrap up to N lines, then
 * ellipsis, then tooltip only when actually overflowing"
 * behaviour.
 *
 * Why this pattern wins:
 *   - Short labels render with NO truncation and NO tooltip —
 *     hovering them never spawns a tooltip the reader doesn't need.
 *   - Mid-length labels wrap to 2 lines and stay fully visible —
 *     much better than premature ellipsis.
 *   - Only TRULY oversized labels get the ellipsis, and only those
 *     spawn a tooltip on hover so the full text is recoverable.
 *
 * Implementation:
 *   - CSS `-webkit-line-clamp` is the cross-browser line-clamp
 *     standard (still vendor-prefixed in spec but supported by
 *     every modern engine).
 *   - Overflow detection compares scrollHeight to clientHeight via
 *     a ResizeObserver, so the truncation flag updates when the
 *     sidebar resizes (mobile drawer width changes, font scaling,
 *     etc.). Skipping `useLayoutEffect` during SSR is the
 *     `useIsoLayoutEffect` indirection above.
 *
 *  The Tooltip is rendered with `disableInteractive` so hover-out
 *  is immediate and the tooltip doesn't block the underlying
 *  click area.
 */
function SidebarLabel({ label, sx }: { label: string; sx?: object }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      // +1 px slack for sub-pixel rounding in some engines so we
      // don't flag a perfectly-fitting label as overflowing.
      setIsOverflowing(el.scrollHeight > el.clientHeight + 1);
    };
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [label]);

  const text = (
    <Typography
      ref={ref as unknown as React.Ref<HTMLSpanElement>}
      component="span"
      variant="body2"
      sx={{
        display: '-webkit-box',
        WebkitBoxOrient: 'vertical',
        WebkitLineClamp: MAX_LABEL_LINES,
        overflow: 'hidden',
        wordBreak: 'break-word',
        lineHeight: 1.35,
        // The flex parent (ListItemButton) needs `minWidth: 0`
        // on the child for the ellipsis to take effect; do it
        // here so the consumer doesn't have to reach in.
        minWidth: 0,
        flex: 1,
        ...sx,
      }}
    >
      {label}
    </Typography>
  );

  if (!isOverflowing) return text;

  return (
    <Tooltip
      title={label}
      placement="right"
      arrow
      enterDelay={300}
      enterNextDelay={150}
      disableInteractive
    >
      {text}
    </Tooltip>
  );
}
