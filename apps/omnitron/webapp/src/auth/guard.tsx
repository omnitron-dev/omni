import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { SplashScreen } from '@omnitron-dev/prism';
import { useAuthStore } from './store';
import { sanitizeReturnTo } from 'src/utils/errors';

// ---------------------------------------------------------------------------
// Auth Guard — requires authenticated user
// ---------------------------------------------------------------------------

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { user, initialized, initialize } = useAuthStore();
  const location = useLocation();

  useEffect(() => {
    initialize();
  }, [initialize]);

  if (!initialized) {
    // `LoadingScreen` is prism's component for lazy route CONTENT inside a
    // layout — a lone 4px bar. This is an app-level gate: nothing at all is
    // on screen behind it, and on a cold load the session probe takes long
    // enough that a bare bar reads as a page that failed to render.
    // `SplashScreen` is the one prism documents for auth checks.
    return <SplashScreen fullScreen message="Checking your session…" />;
  }

  if (!user) {
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/auth/sign-in?returnTo=${returnTo}`} replace />;
  }

  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// Guest Guard — only for unauthenticated users (sign-in page)
// ---------------------------------------------------------------------------

interface GuestGuardProps {
  children: React.ReactNode;
}

export function GuestGuard({ children }: GuestGuardProps) {
  const { user, initialized, initialize } = useAuthStore();
  const location = useLocation();

  useEffect(() => {
    initialize();
  }, [initialize]);

  if (!initialized) {
    // `LoadingScreen` is prism's component for lazy route CONTENT inside a
    // layout — a lone 4px bar. This is an app-level gate: nothing at all is
    // on screen behind it, and on a cold load the session probe takes long
    // enough that a bare bar reads as a page that failed to render.
    // `SplashScreen` is the one prism documents for auth checks.
    return <SplashScreen fullScreen message="Checking your session…" />;
  }

  if (user) {
    const params = new URLSearchParams(location.search);
    const returnTo = sanitizeReturnTo(params.get('returnTo'));
    return <Navigate to={returnTo} replace />;
  }

  return <>{children}</>;
}
