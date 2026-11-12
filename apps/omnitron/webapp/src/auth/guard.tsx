import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { OmnitronSplash } from '@omnitron-dev/prism/identity';
import { useAuthStore } from './store';
import { sanitizeReturnTo } from 'src/utils/errors';
import { ConsoleAccessProvider } from './access';

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
    // Session validation has no measurable total: keep the brand activity indeterminate.
    return <OmnitronSplash fullScreen message="Checking your session…" />;
  }

  if (!user) {
    const returnTo = encodeURIComponent(location.pathname + location.search + location.hash);
    return <Navigate to={`/auth/sign-in?returnTo=${returnTo}`} replace />;
  }

  return <ConsoleAccessProvider key={`${user.id}:${useAuthStore.getState().sessionId}`}>{children}</ConsoleAccessProvider>;
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
    // Session validation has no measurable total: keep the brand activity indeterminate.
    return <OmnitronSplash fullScreen message="Checking your session…" />;
  }

  if (user) {
    const params = new URLSearchParams(location.search);
    const returnTo = sanitizeReturnTo(params.get('returnTo'));
    return <Navigate to={returnTo} replace />;
  }

  return <>{children}</>;
}
