import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { LoadingScreen } from '@omnitron-dev/prism';
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
    return <LoadingScreen />;
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
    return <LoadingScreen />;
  }

  if (user) {
    const params = new URLSearchParams(location.search);
    const returnTo = sanitizeReturnTo(params.get('returnTo'));
    return <Navigate to={returnTo} replace />;
  }

  return <>{children}</>;
}
