import { useEffect } from 'react';
import { BrowserRouter, useLocation } from 'react-router-dom';

import { PrismProvider } from '@omnitron-dev/prism/core';
import { SnackbarProvider } from '@omnitron-dev/prism/components/snackbar';
import { MotionLazy } from '@omnitron-dev/prism/components/animate';
import { NavigationProgress } from '@omnitron-dev/prism/components/navigation-progress';
import { ScrollToTop } from '@omnitron-dev/prism/components/scroll-to-top';
import { ErrorBoundary } from '@omnitron-dev/prism/components/error-boundary';

import { MultiBackendProvider } from '@omnitron-dev/prism/netron';
import { daemonClient } from 'src/netron/client';
import { Router } from 'src/routes';
import { useProjectStore } from 'src/stores/project.store';
import { reportCrash } from 'src/utils/report-crash';
import { consoleTheme } from 'src/theme';

function AppContent() {
  const { pathname } = useLocation();
  const saveCurrentRoute = useProjectStore((s) => s.saveCurrentRoute);

  // Track route changes — save current path for workspace restore on switch
  useEffect(() => {
    // Don't save auth routes
    if (!pathname.startsWith('/auth')) {
      saveCurrentRoute(pathname);
    }
  }, [pathname, saveCurrentRoute]);

  return (
    <>
      <NavigationProgress pathname={pathname} />
      <ScrollToTop pathname={pathname} />
      <ErrorBoundary showDetails onError={reportCrash}>
        <Router />
      </ErrorBoundary>
    </>
  );
}

export function App() {
  return (
    <PrismProvider
      themeOverrides={consoleTheme}
      defaultSettings={{
        mode: 'dark',
        preset: 'midnight',
        direction: 'ltr',
      }}
    >
      <MotionLazy>
        <MultiBackendProvider client={daemonClient} autoConnect>
          <SnackbarProvider>
            <BrowserRouter>
              <AppContent />
            </BrowserRouter>
          </SnackbarProvider>
        </MultiBackendProvider>
      </MotionLazy>
    </PrismProvider>
  );
}
