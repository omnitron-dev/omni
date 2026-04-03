import { useEffect } from 'react';
import { BrowserRouter, useLocation } from 'react-router-dom';

import {
  PrismProvider,
  SnackbarProvider,
  MotionLazy,
  NavigationProgress,
  ScrollToTop,
  ErrorBoundary,
} from '@omnitron/prism';

import { MultiBackendProvider } from '@omnitron/prism/netron';
import { daemonClient } from 'src/netron/client';
import { Router } from 'src/routes';
import { CommandPalette } from 'src/components/command-palette';
import { useProjectStore } from 'src/stores/project.store';

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
      <CommandPalette />
      <ErrorBoundary>
        <Router />
      </ErrorBoundary>
    </>
  );
}

export function App() {
  return (
    <PrismProvider
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
