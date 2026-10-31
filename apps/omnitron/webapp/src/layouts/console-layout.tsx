import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Stack from '@mui/material/Stack';
import { ErrorBoundary } from '@omnitron-dev/prism/components/error-boundary';
import { DashboardLayout, useLayoutConfig } from '@omnitron-dev/prism/layouts';
import { SplashScreen } from '@omnitron-dev/prism/components/loading-screen';
import { usePrismContext } from '@omnitron-dev/prism/core';
import { useSettingsStore } from '@omnitron-dev/prism/state';
import type { ThemeMode } from '@omnitron-dev/prism/theme';
import type { LayoutNavData } from '@omnitron-dev/prism/layouts';
import { StatusBar } from 'src/components/status-bar';
import { DaemonOfflineBanner } from 'src/components/daemon-offline-banner';
import { ConsoleUpdateBanner } from 'src/components/console-update-banner';
import { isVisible } from 'src/components/keyboard-model';
import { ConsoleKeyboard, useConsoleKeyboard } from 'src/components/console-keyboard';
import { OmnitronLogo } from 'src/components/omnitron-logo';

import {
  DashboardIcon,
  AppsIcon,
  LogsIcon,
  MetricsIcon,
  NodesIcon,
  ProjectIcon,
  ContainersIcon,
  DeployIcon,
  AlertIcon,
  SettingsIcon,
  PipelineIcon,
  TraceIcon,
  DashboardBuilderIcon,
  StacksIcon,
  ServerIcon,
  AuditIcon,
  LogoutIcon,
  ReleaseIcon,
  FolderIcon,
  SearchIcon,
} from 'src/assets/icons';

import { useAuthStore } from 'src/auth/store';
import { useAccess, PAGE_PERMISSIONS, PageAccess, AccessBoundary } from 'src/auth/access';
import { ProjectSwitcher } from 'src/components/project-switcher';
import { useActiveProject } from 'src/stores/project.store';
import { reportCrash } from 'src/utils/report-crash';
import { useAlertNotifications } from 'src/hooks/use-alert-notifications';

const TerminalPage = lazy(() => import('src/pages/terminal'));
const FilesPage = lazy(() => import('src/pages/files'));

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
          items: [{ id: 'dashboard', title: 'Dashboard', path: '/', icon: <DashboardIcon /> }],
        },
        {
          id: 'observability',
          subheader: 'Observability',
          items: [{ id: 'logs', title: 'Logs', path: '/logs', icon: <LogsIcon /> }],
        },
        {
          id: 'infrastructure',
          subheader: 'Infrastructure',
          items: [
            { id: 'projects', title: 'Projects', path: '/projects', icon: <ProjectIcon /> },
            { id: 'nodes', title: 'Nodes', path: '/nodes', icon: <NodesIcon /> },
            { id: 'topology', title: 'Topology', path: '/topology', icon: <NodesIcon /> },
            { id: 'terminal', title: 'SSH workspace', path: '/terminal', icon: <ServerIcon /> },
            { id: 'files', title: 'Files', path: '/files', icon: <FolderIcon /> },
            {
              id: 'pipelines',
              title: 'Pipelines',
              path: '/pipelines',
              icon: <PipelineIcon />,
              selectionPrefix: '/pipelines',
            },
            {
              id: 'releases',
              title: 'Releases',
              path: '/releases',
              icon: <ReleaseIcon />,
              selectionPrefix: '/releases',
            },
          ],
        },
        {
          id: 'system',
          subheader: 'System',
          items: [
            { id: 'settings', title: 'Settings', path: '/settings', icon: <SettingsIcon /> },
            { id: 'audit', title: 'Audit', path: '/audit', icon: <AuditIcon /> },
            { id: 'access', title: 'Access', path: '/access', icon: <SettingsIcon /> },
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
          { id: 'releases', title: 'Releases', path: '/releases', icon: <ReleaseIcon />, selectionPrefix: '/releases' },
          { id: 'topology', title: 'Topology', path: '/topology', icon: <NodesIcon /> },
          { id: 'nodes', title: 'Nodes', path: '/nodes', icon: <NodesIcon /> },
          { id: 'terminal', title: 'SSH workspace', path: '/terminal', icon: <ServerIcon /> },
          { id: 'files', title: 'Files', path: '/files', icon: <FolderIcon /> },
          { id: 'containers', title: 'Containers', path: '/containers', icon: <ContainersIcon /> },
          { id: 'deployments', title: 'Deployments', path: '/deployments', icon: <DeployIcon /> },
          {
            id: 'pipelines',
            title: 'Pipelines',
            path: '/pipelines',
            icon: <PipelineIcon />,
            selectionPrefix: '/pipelines',
          },
        ],
      },
      {
        id: 'system',
        subheader: 'System',
        items: [
          {
            id: 'dashboard-builder',
            title: 'Dashboard Builder',
            path: '/dashboard-builder',
            icon: <DashboardBuilderIcon />,
          },
          { id: 'settings', title: 'Settings', path: '/settings', icon: <SettingsIcon /> },
          { id: 'audit', title: 'Audit', path: '/audit', icon: <AuditIcon /> },
          { id: 'access', title: 'Access', path: '/access', icon: <SettingsIcon /> },
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
    <Stack
      direction="row"
      spacing={1}
      sx={{
        alignItems: 'center',
      }}
    >
      <OmnitronLogo size={48} />
      {showText && (
        <Typography
          variant="subtitle1"
          noWrap
          sx={{
            fontWeight: 800,
            letterSpacing: 2,
            textTransform: 'uppercase',
            fontSize: '0.85rem',
          }}
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
        <path
          fill="currentColor"
          opacity="0.4"
          d="M21.5 14.08C20.31 14.67 18.98 15 17.58 15C12.86 15 9.08 11.22 9.08 6.5C9.08 5.1 9.42 3.77 10 2.58C5.73 3.63 2.58 7.5 2.58 12.08C2.58 17.6 7.06 22.08 12.58 22.08C17.16 22.08 21.04 18.93 22.08 14.67C21.89 14.81 21.7 14.94 21.5 14.08Z"
        />
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21.5 14.08C20.31 14.67 18.98 15 17.58 15C12.86 15 9.08 11.22 9.08 6.5C9.08 5.1 9.42 3.77 10 2.58C5.73 3.63 2.58 7.5 2.58 12.08C2.58 17.6 7.06 22.08 12.58 22.08C17.16 22.08 21.04 18.93 22.08 14.67"
        />
      </Box>
    );
  }
  if (mode === 'light') {
    return (
      <Box component="svg" viewBox="0 0 24 24" sx={{ width: 20, height: 20 }}>
        <circle fill="currentColor" opacity="0.4" cx="12" cy="12" r="5" />
        <circle fill="none" stroke="currentColor" strokeWidth="1.5" cx="12" cy="12" r="5" />
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          d="M12 2V4M12 20V22M4 12H2M22 12H20M19.78 4.22L18.36 5.64M5.64 18.36L4.22 19.78M19.78 19.78L18.36 18.36M5.64 5.64L4.22 4.22"
        />
      </Box>
    );
  }
  return (
    <Box component="svg" viewBox="0 0 24 24" sx={{ width: 20, height: 20 }}>
      <path
        fill="currentColor"
        opacity="0.4"
        d="M2 10C2 6.23 2 4.34 3.17 3.17C4.34 2 6.23 2 10 2H14C17.77 2 19.66 2 20.83 3.17C22 4.34 22 6.23 22 10V11C22 11.55 21.55 12 21 12H3C2.45 12 2 11.55 2 11V10Z"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        d="M2 10C2 6.23 2 4.34 3.17 3.17C4.34 2 6.23 2 10 2H14C17.77 2 19.66 2 20.83 3.17C22 4.34 22 6.23 22 10V14C22 17.77 22 19.66 20.83 20.83C19.66 22 17.77 22 14 22H10C6.23 22 4.34 22 3.17 20.83C2 19.66 2 17.77 2 14V10Z"
      />
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
  const { openCommands, openHelp } = useConsoleKeyboard();
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
    <Stack
      direction="row"
      spacing={0.5}
      sx={{
        alignItems: 'center',
      }}
    >
      <Tooltip title="Commands · Ctrl / ⌘ K">
        <IconButton aria-label="Open Console commands" onClick={openCommands} sx={headerIconBtnSx}>
          <SearchIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </Tooltip>
      <Tooltip title="Keyboard · Ctrl / ⌘ /">
        <IconButton aria-label="Keyboard shortcuts" onClick={openHelp} sx={headerIconBtnSx}>
          <Typography component="span" sx={{ fontWeight: 600, fontSize: 18 }}>
            ?
          </Typography>
        </IconButton>
      </Tooltip>
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
  const allNavData = useNavData();
  const { can } = useAccess();
  const navData = allNavData
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        const permission = PAGE_PERMISSIONS[item.path?.split('/')[1] || 'dashboard'];
        return !permission || can(permission);
      }),
    }))
    .filter((section) => section.items.length > 0);
  const location = useLocation();
  const terminalVisible = location.pathname === '/terminal';
  const filesVisible = location.pathname === '/files';
  const [filesVisited, setFilesVisited] = useState(filesVisible);
  useEffect(() => {
    if (filesVisible) setFilesVisited(true);
  }, [filesVisible]);
  useEffect(() => {
    const main = document.getElementById('main-content');
    main?.scrollTo({ top: 0 });
    // A retained page can hide the focused terminal/file row on navigation.
    if (main && (!document.activeElement || !isVisible(document.activeElement as HTMLElement)))
      main.focus({ preventScroll: true });
  }, [location.pathname]);
  const [terminalVisited, setTerminalVisited] = useState(terminalVisible);
  useEffect(() => {
    if (terminalVisible) setTerminalVisited(true);
  }, [terminalVisible]);
  // Every page of the console, so an alert that fires is heard wherever the
  // operator is — and only while someone is signed in to hear it.
  useAlertNotifications(useAuthStore((s) => Boolean(s.user)));

  return (
    <ConsoleKeyboard navigation={navData}>
      <DashboardLayout
        contentMode="workspace"
        footer={<StatusBar docked />}
        logo={<ConsoleLogo />}
        navData={navData}
        persistKey="console"
        initialConfig={{
          navigationMenuType: 'sidenav',
          sidenavVariant: 'default',
          navColor: 'default',
        }}
        headerSlots={{
          leftArea: (
            <Box data-keyboard-region="Workspace" tabIndex={-1}>
              <ProjectSwitcher />
            </Box>
          ),
          rightArea: <HeaderRight />,
          // Notices take space inside Prism's bounded workspace, so the footer
          // and terminal stay inside the viewport when a notice appears.
          bottomArea: (
            <>
              <DaemonOfflineBanner />
              <ConsoleUpdateBanner />
            </>
          ),
        }}
        slotProps={{
          main: {
            sx:
              terminalVisible || filesVisible || location.pathname === '/topology'
                ? { p: { xs: 1, sm: 1.5, md: 2 }, minHeight: 0 }
                : { minWidth: 0, minHeight: 0, overflowY: 'auto', p: { xs: 1.5, sm: 2, md: 2.5 } },
          },
        }}
      >
        <ErrorBoundary showDetails onError={reportCrash}>
          {/*
          A route chunk, not the app — so this stays contained rather than
          full-screen, and the chrome around it (sidebar, header) keeps
          rendering. What it gains is a message: measured on this host, a cold
          route took thirty seconds to arrive, and for all thirty a bare
          progress bar is indistinguishable from a page that broke.
        */}
          <Suspense fallback={<SplashScreen variant="linear" message="Loading…" />}>
            {!terminalVisible && !filesVisible && (
              <PageAccess>
                <Outlet />
              </PageAccess>
            )}
          </Suspense>
          {filesVisited && (
            <Box
              sx={{
                display: filesVisible ? 'flex' : 'none',
                flexDirection: 'column',
                flex: 1,
                minHeight: 0,
                minWidth: 0,
              }}
            >
              <Suspense fallback={<SplashScreen variant="linear" message="Loading files…" />}>
                <AccessBoundary permission="OmnitronFiles.roots">
                  <FilesPage visible={filesVisible} />
                </AccessBoundary>
              </Suspense>
            </Box>
          )}
          {terminalVisited && (
            <Box
              sx={{
                display: terminalVisible ? 'flex' : 'none',
                flexDirection: 'column',
                flex: 1,
                minHeight: 0,
                minWidth: 0,
              }}
            >
              <Suspense fallback={<SplashScreen variant="linear" message="Loading SSH workspace…" />}>
                <AccessBoundary permission="OmnitronTerminal.open">
                  <TerminalPage visible={terminalVisible} />
                </AccessBoundary>
              </Suspense>
            </Box>
          )}
        </ErrorBoundary>
      </DashboardLayout>
    </ConsoleKeyboard>
  );
}
