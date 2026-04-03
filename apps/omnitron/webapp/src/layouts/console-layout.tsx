import { Suspense, useMemo } from 'react';
import { Outlet } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Stack from '@mui/material/Stack';
import { DashboardLayout, LoadingScreen, useLayoutConfig, usePrismContext, useSettingsStore } from '@omnitron/prism';
import type { ThemeMode, LayoutNavData } from '@omnitron/prism';
import { StatusBar } from 'src/components/status-bar';
import { OmnitronLogo } from 'src/components/omnitron-logo';

import {
  DashboardIcon,
  AppsIcon,
  LogsIcon,
  MetricsIcon,
  NodesIcon,
  ContainersIcon,
  DeployIcon,
  AlertIcon,
  SettingsIcon,
  PipelineIcon,
  TraceIcon,
  DashboardBuilderIcon,
  StacksIcon,
  ServerIcon,
  LogoutIcon,
} from 'src/assets/icons';

import { useAuthStore } from 'src/auth/store';
import { ErrorBoundary } from 'src/components/error-boundary';
import { ProjectSwitcher } from 'src/components/project-switcher';
import { useActiveProject } from 'src/stores/project.store';

// =============================================================================
// Navigation — conditional on active project
// =============================================================================

/**
 * When no project is active, show minimal nav:
 *   Dashboard (standalone daemon overview)
 *   System Info
 *   Settings
 *
 * When a project is selected, show full project-scoped nav:
 *   Overview: Dashboard, Applications, Stacks
 *   Observability: Logs, Metrics, Traces, Alerts
 *   Infrastructure: Topology, Containers, Deployments, Pipelines
 *   System: Dashboard Builder, Settings, System Info
 */
function useNavData(): LayoutNavData {
  const activeProject = useActiveProject();

  return useMemo(() => {
    if (!activeProject) {
      // Omnitron system workspace
      return [
        {
          id: 'overview',
          subheader: 'Overview',
          items: [
            { id: 'dashboard', title: 'Dashboard', path: '/', icon: <DashboardIcon /> },
          ],
        },
        {
          id: 'observability',
          subheader: 'Observability',
          items: [
            { id: 'logs', title: 'Logs', path: '/logs', icon: <LogsIcon /> },
          ],
        },
        {
          id: 'infrastructure',
          subheader: 'Infrastructure',
          items: [
            { id: 'nodes', title: 'Nodes', path: '/nodes', icon: <NodesIcon /> },
          ],
        },
        {
          id: 'system',
          subheader: 'System',
          items: [
            { id: 'settings', title: 'Settings', path: '/settings', icon: <SettingsIcon /> },
            { id: 'system-info', title: 'System Info', path: '/system', icon: <ServerIcon /> },
          ],
        },
      ];
    }

    // Project active — full navigation
    return [
      {
        id: 'overview',
        subheader: 'Overview',
        items: [
          { id: 'dashboard', title: 'Dashboard', path: '/', icon: <DashboardIcon /> },
          { id: 'apps', title: 'Applications', path: '/apps', icon: <AppsIcon />, selectionPrefix: '/apps' },
        ],
      },
      {
        id: 'observability',
        subheader: 'Observability',
        items: [
          { id: 'logs', title: 'Logs', path: '/logs', icon: <LogsIcon /> },
          { id: 'metrics', title: 'Metrics', path: '/metrics', icon: <MetricsIcon /> },
          { id: 'traces', title: 'Traces', path: '/traces', icon: <TraceIcon /> },
          { id: 'alerts', title: 'Alerts', path: '/alerts', icon: <AlertIcon /> },
        ],
      },
      {
        id: 'infrastructure',
        subheader: 'Infrastructure',
        items: [
          { id: 'stacks', title: 'Stacks', path: '/stacks', icon: <StacksIcon />, selectionPrefix: '/stacks' },
          { id: 'topology', title: 'Topology', path: '/topology', icon: <NodesIcon /> },
          { id: 'containers', title: 'Containers', path: '/containers', icon: <ContainersIcon /> },
          { id: 'deployments', title: 'Deployments', path: '/deployments', icon: <DeployIcon /> },
          { id: 'pipelines', title: 'Pipelines', path: '/pipelines', icon: <PipelineIcon />, selectionPrefix: '/pipelines' },
        ],
      },
      {
        id: 'system',
        subheader: 'System',
        items: [
          { id: 'dashboard-builder', title: 'Dashboard Builder', path: '/dashboard-builder', icon: <DashboardBuilderIcon /> },
          { id: 'settings', title: 'Settings', path: '/settings', icon: <SettingsIcon /> },
          { id: 'system-info', title: 'System Info', path: '/system', icon: <ServerIcon /> },
        ],
      },
    ];
  }, [activeProject]);
}

// =============================================================================
// Logo
// =============================================================================

function ConsoleLogo() {
  const { sidenavCollapsed, sidenavVariant } = useLayoutConfig();
  const showText = !sidenavCollapsed && sidenavVariant !== 'mini';

  return (
    <Stack direction="row" alignItems="center" spacing={1}>
      <OmnitronLogo size={48} />
      {showText && (
        <Typography
          variant="subtitle1"
          fontWeight={800}
          letterSpacing={2}
          noWrap
          sx={{ textTransform: 'uppercase', fontSize: '0.85rem' }}
        >
          Omnitron
        </Typography>
      )}
    </Stack>
  );
}

// =============================================================================
// Header
// =============================================================================

function ThemeModeIcon({ mode }: { mode: string }) {
  if (mode === 'dark') {
    return (
      <Box component="svg" viewBox="0 0 24 24" sx={{ width: 20, height: 20 }}>
        <path fill="currentColor" opacity="0.4" d="M21.5 14.08C20.31 14.67 18.98 15 17.58 15C12.86 15 9.08 11.22 9.08 6.5C9.08 5.1 9.42 3.77 10 2.58C5.73 3.63 2.58 7.5 2.58 12.08C2.58 17.6 7.06 22.08 12.58 22.08C17.16 22.08 21.04 18.93 22.08 14.67C21.89 14.81 21.7 14.94 21.5 14.08Z" />
        <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M21.5 14.08C20.31 14.67 18.98 15 17.58 15C12.86 15 9.08 11.22 9.08 6.5C9.08 5.1 9.42 3.77 10 2.58C5.73 3.63 2.58 7.5 2.58 12.08C2.58 17.6 7.06 22.08 12.58 22.08C17.16 22.08 21.04 18.93 22.08 14.67" />
      </Box>
    );
  }
  if (mode === 'light') {
    return (
      <Box component="svg" viewBox="0 0 24 24" sx={{ width: 20, height: 20 }}>
        <circle fill="currentColor" opacity="0.4" cx="12" cy="12" r="5" />
        <circle fill="none" stroke="currentColor" strokeWidth="1.5" cx="12" cy="12" r="5" />
        <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M12 2V4M12 20V22M4 12H2M22 12H20M19.78 4.22L18.36 5.64M5.64 18.36L4.22 19.78M19.78 19.78L18.36 18.36M5.64 5.64L4.22 4.22" />
      </Box>
    );
  }
  return (
    <Box component="svg" viewBox="0 0 24 24" sx={{ width: 20, height: 20 }}>
      <path fill="currentColor" opacity="0.4" d="M2 10C2 6.23 2 4.34 3.17 3.17C4.34 2 6.23 2 10 2H14C17.77 2 19.66 2 20.83 3.17C22 4.34 22 6.23 22 10V11C22 11.55 21.55 12 21 12H3C2.45 12 2 11.55 2 11V10Z" />
      <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M2 10C2 6.23 2 4.34 3.17 3.17C4.34 2 6.23 2 10 2H14C17.77 2 19.66 2 20.83 3.17C22 4.34 22 6.23 22 10V14C22 17.77 22 19.66 20.83 20.83C19.66 22 17.77 22 14 22H10C6.23 22 4.34 22 3.17 20.83C2 19.66 2 17.77 2 14V10Z" />
      <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M2 12H22" />
    </Box>
  );
}

/** Shared icon button style — no border, scale on hover (portal pattern) */
const headerIconBtnSx = {
  p: 0.75,
  transition: 'transform 0.2s ease',
  '&:hover': { transform: 'scale(1.1)', bgcolor: 'transparent' },
} as const;

function HeaderRight() {
  const signOut = useAuthStore((s) => s.signOut);
  const { setMode } = usePrismContext();
  const mode = useSettingsStore((s: any) => s.mode) as string;

  const handleCycleTheme = () => {
    const cycle: ThemeMode[] = ['light', 'dark', 'system'];
    const idx = cycle.indexOf(mode as ThemeMode);
    setMode(cycle[(idx + 1) % cycle.length]!);
  };

  const themeTooltip = mode === 'light' ? 'Dark mode' : mode === 'dark' ? 'System mode' : 'Light mode';

  return (
    <Stack direction="row" alignItems="center" spacing={0.5}>
      <Tooltip title={themeTooltip}>
        <IconButton disableRipple onClick={handleCycleTheme} sx={headerIconBtnSx}>
          <ThemeModeIcon mode={mode} />
        </IconButton>
      </Tooltip>

      <Tooltip title="Sign out">
        <IconButton disableRipple onClick={() => signOut()} sx={headerIconBtnSx}>
          <LogoutIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

// =============================================================================
// Layout
// =============================================================================

export function ConsoleLayout() {
  const navData = useNavData();

  return (
    <DashboardLayout
      logo={<ConsoleLogo />}
      navData={navData}
      persistKey="console"
      initialConfig={{
        navigationMenuType: 'sidenav',
        sidenavVariant: 'default',
        navColor: 'default',
      }}
      headerSlots={{
        leftArea: <ProjectSwitcher />,
        rightArea: <HeaderRight />,
      }}
      slotProps={{
        main: {
          sx: { pb: { xs: 6, sm: 7, md: 8 } },
        },
      }}
    >
      <ErrorBoundary>
        <Suspense fallback={<LoadingScreen />}>
          <Outlet />
        </Suspense>
      </ErrorBoundary>
      <StatusBar />
    </DashboardLayout>
  );
}
