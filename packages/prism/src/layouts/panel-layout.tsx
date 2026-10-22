import { useEffect, useId, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import SvgIcon from '@mui/material/SvgIcon';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme, type SxProps, type Theme, type Breakpoint } from '@mui/material/styles';
import { Scrollbar } from '../components/scrollbar/scrollbar.js';
import { SidebarToggle } from './sidebar-toggle.js';
import { useSettingsStore } from '../state/stores/settings.js';

export interface PanelLayoutProps {
  children: ReactNode;
  /** Render a compact, actionable index while keeping the same component mounted. */
  panel: ReactNode | ((state: { collapsed: boolean }) => ReactNode);
  title: string;
  /** Translate all three action labels in the host application. */
  labels: { expand: string; collapse: string; close: string };
  /** Independent from the dashboard and other panels. */
  persistKey?: string;
  defaultCollapsed?: boolean;
  /** Close the mobile drawer when the host changes its active document/selection. */
  navigationKey?: string;
  width?: number;
  collapsedWidth?: number;
  /** Stable in both modes. A graph can use the same height as its canvas. */
  height?: number | string;
  layoutQuery?: Breakpoint;
  /** Top of the sticky panel below the application header. */
  offset?: number;
  sx?: SxProps<Theme>;
}

/** Secondary navigation: a collapsible desktop rail and an accessible mobile drawer.
 * Collapse hides, rather than destroys, panel content. The document/editor is never
 * reparented or remounted when either navigation panel changes state.
 */
export function PanelLayout({
  children,
  panel,
  title,
  labels,
  persistKey,
  defaultCollapsed = false,
  navigationKey,
  width = 264,
  collapsedWidth = 64,
  height,
  layoutQuery = 'md',
  offset = 88,
  sx,
}: PanelLayoutProps) {
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up(layoutQuery));
  const saved = useSettingsStore((s) => s.sidebarCollapsed);
  const save = useSettingsStore((s) => s.setSidebarCollapsed);
  const [collapsed, setCollapsed] = useState(() =>
    persistKey ? (saved[persistKey] ?? defaultCollapsed) : defaultCollapsed
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const id = useId();
  const renderPanel = (compact: boolean) => (typeof panel === 'function' ? panel({ collapsed: compact }) : panel);
  useEffect(() => {
    setMobileOpen(false);
  }, [navigationKey, wide]);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    if (persistKey) save(persistKey, next);
  };
  return (
    <Box
      sx={[
        { display: 'flex', alignItems: 'flex-start', gap: { xs: 0, md: 3 }, minWidth: 0 },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {wide && (
        <Box
          component="aside"
          aria-label={title}
          sx={{
            width: collapsed ? collapsedWidth : width,
            height: height ?? `calc(100dvh - ${offset + 24}px)`,
            minHeight: 160,
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            position: 'sticky',
            top: offset,
            borderRight: 1,
            borderColor: 'divider',
            transition: theme.transitions.create('width', { duration: theme.transitions.duration.shorter }),
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
          }}
        >
          <Box
            sx={{
              height: 48,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              pr: 3,
              pl: 1.5,
              overflow: 'hidden',
            }}
          >
            {!collapsed && (
              <Typography component="div" variant="subtitle2" noWrap>
                {title}
              </Typography>
            )}
          </Box>
          <SidebarToggle
            collapsed={collapsed}
            labels={labels}
            onClick={toggle}
            aria-controls={id + '-desktop'}
            sx={{ top: 24 }}
          />
          <Scrollbar
            id={id + '-desktop'}
            hidden={collapsed && typeof panel !== 'function'}
            sx={{ flex: 1, overscrollBehavior: 'contain', px: collapsed ? 0.5 : 1.5, pb: 2 }}
          >
            {renderPanel(collapsed)}
          </Scrollbar>
        </Box>
      )}
      <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
        {!wide && (
          <Button
            onClick={() => setMobileOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={mobileOpen}
            sx={{ mb: 2 }}
            startIcon={
              <SvgIcon>
                <path d="M3 5h18v2H3zm0 6h18v2H3zm0 6h18v2H3z" />
              </SvgIcon>
            }
          >
            {title}
          </Button>
        )}
        {children}
      </Box>
      {!wide && (
        <Drawer
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          slotProps={{
            paper: {
              role: 'dialog',
              'aria-modal': true,
              'aria-label': title,
              sx: { width: `min(${width + 32}px, calc(100vw - 32px))` },
            },
          }}
        >
          <Box sx={{ minHeight: 64, px: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="subtitle1" sx={{ flex: 1 }}>
              {title}
            </Typography>
            <IconButton onClick={() => setMobileOpen(false)} aria-label={labels.close}>
              <span aria-hidden="true">×</span>
            </IconButton>
          </Box>
          <Scrollbar sx={{ flex: 1, px: 2, pb: 2 }}>{renderPanel(false)}</Scrollbar>
        </Drawer>
      )}
    </Box>
  );
}
