import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Stack from '@mui/material/Stack';
import { ErrorBoundary } from '@omnitron-dev/prism/components/error-boundary';
import { DashboardLayout, useLayoutConfig } from '@omnitron-dev/prism/layouts';
import { OmnitronBrand, OmnitronMark, OmnitronSplash } from '@omnitron-dev/prism/identity';
import { usePrismContext } from '@omnitron-dev/prism/core';
import { ThemeModeIcon } from '@omnitron-dev/prism/icons';
import { consoleNavigation } from 'src/routes/navigation';
import { StatusBar } from 'src/components/status-bar';
import { DaemonOfflineBanner } from 'src/components/daemon-offline-banner';
import { ConsoleUpdateBanner } from 'src/components/console-update-banner';
import { isVisible } from 'src/components/keyboard-model';
import { ConsoleKeyboard, useConsoleKeyboard } from 'src/components/console-keyboard';

import { LogoutIcon, SearchIcon } from 'src/assets/icons';

import { useAuthStore } from 'src/auth/store';
import { useAccess, PageAccess, AccessBoundary } from 'src/auth/access';
import { ProjectSwitcher } from 'src/components/project-switcher';
import { StackSelector } from 'src/components/stack-selector';
import { useWorkspace } from 'src/routes/workspace';
import { reportCrash } from 'src/utils/report-crash';
import { FlowNotifications } from 'src/components/flow-notifications';
import { useAlertNotifications } from 'src/hooks/use-alert-notifications';

const TerminalPage = lazy(() => import('src/pages/terminal'));
const FilesPage = lazy(() => import('src/pages/files'));

// =============================================================================
// Logo
// =============================================================================

function ConsoleLogo() {
  const { sidenavCollapsed, sidenavVariant } = useLayoutConfig();
  const showText = !sidenavCollapsed && sidenavVariant !== 'mini';

  return showText ? <OmnitronBrand size={36} /> : <OmnitronMark size={36} />;
}

// =============================================================================
// Header
// =============================================================================

const nextThemeMode = { light: 'dark', dark: 'system', system: 'light' } as const;

/** Header controls retain the same quiet hover and focus states as the workspace. */
const headerIconBtnSx = {
  p: 0.75,
  '&:hover': { bgcolor: 'action.hover' },
} as const;

function HeaderRight() {
  const { openCommands, openHelp } = useConsoleKeyboard();
  const signOut = useAuthStore((s) => s.signOut);
  const { settings: { mode }, setMode } = usePrismContext();
  const nextMode = nextThemeMode[mode];
  const themeTooltip = `Switch to ${nextMode} mode`;

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
        <IconButton disableRipple aria-label={themeTooltip} onClick={() => setMode(nextMode)} sx={headerIconBtnSx}>
          <ThemeModeIcon mode={mode} sx={{ fontSize: 20 }} />
        </IconButton>
      </Tooltip>
      <Tooltip title="Sign out">
        <IconButton aria-label="Sign out" disableRipple onClick={() => signOut()} sx={headerIconBtnSx}>
          <LogoutIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

// =============================================================================
// Layout
// =============================================================================

// The expanded desktop rail insets its logo by three spacing units.
const workspaceGutter = { xs: 1, sm: 2, lg: 3 };

export function ConsoleLayout() {
  const { project, stack, pagePath } = useWorkspace();
  const { can, snapshot } = useAccess();
  const location = useLocation();
  const navData = useMemo(
    () => consoleNavigation({ project, stack }, can, location.pathname, location.search),
    [project, stack, can, location.pathname, location.search]
  );
  const terminalVisible = location.pathname === '/terminal';
  const filesVisible = location.pathname === '/files';
  const [filesVisited, setFilesVisited] = useState(filesVisible);
  useEffect(() => {
    if (filesVisible) setFilesVisited(true);
  }, [filesVisible]);
  useEffect(() => {
    const main = document.getElementById('main-content');
    if (!location.hash) main?.scrollTo({ top: 0 });
    // A retained page can hide the focused terminal/file row on navigation.
    if (main && (!document.activeElement || !isVisible(document.activeElement as HTMLElement)))
      main.focus({ preventScroll: true });
  }, [location.pathname, location.hash]);
  const [terminalVisited, setTerminalVisited] = useState(terminalVisible);
  useEffect(() => {
    if (terminalVisible) setTerminalVisited(true);
  }, [terminalVisible]);
  // Every page of the console, so an alert that fires is heard wherever the
  // operator is — and only while someone is signed in to hear it.
  useAlertNotifications(can('OmnitronAlerts.getActiveAlerts') ? snapshot?.userId ?? null : null);

  return (
    <ConsoleKeyboard navigation={navData}>
      {snapshot && can('OmnitronFlows.notifications') && (
        <FlowNotifications
          key={JSON.stringify([snapshot.userId, project, stack])}
          workspace={{ project, ...(project && stack && { stack }) }}
          mayOpen={can('OmnitronFlows.list')}
        />
      )}
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
            <Box data-keyboard-region="Workspace" tabIndex={-1} sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.5, sm: 1 }, minWidth: 0, '@media (max-width: 359px)': { flexDirection: 'column', alignItems: 'flex-start', gap: 0 } }}>
              <ProjectSwitcher />
              <StackSelector />
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
          header: {
            slotProps: { toolbar: { px: workspaceGutter } },
          },
          main: {
            sx:
              terminalVisible || filesVisible || pagePath === '/topology'
                ? { px: workspaceGutter, py: { xs: 1, sm: 1.5, md: 2 }, minHeight: 0 }
                : { minWidth: 0, minHeight: 0, overflowY: 'auto', px: workspaceGutter, py: { xs: 1.5, sm: 2, md: 2.5 } },
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
          <Suspense fallback={<OmnitronSplash message="Loading…" />}>
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
              <Suspense fallback={<OmnitronSplash message="Loading files…" />}>
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
              <Suspense fallback={<OmnitronSplash message="Loading SSH workspace…" />}>
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
