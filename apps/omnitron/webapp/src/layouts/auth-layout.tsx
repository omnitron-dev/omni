import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { AuthCenteredLayout, SplashScreen } from '@omnitron-dev/prism';

/**
 * The sign-in shell.
 *
 * The fallback was a hand-rolled `<Box sx={{ width: '100%', pt: 2 }}>` around
 * a bare MUI `LinearProgress` — a second implementation of something prism
 * already ships, and a worse one: a 4px bar pinned to the top of the card,
 * with no centering, no message, and no indication that anything is coming.
 * On a loaded machine the auth chunk takes seconds to arrive and that is all
 * the page says for the whole wait.
 *
 * `SplashScreen` is prism's component for exactly this — its own docblock
 * says "app-level loading (initial boot, auth checks)" — and it centres the
 * indicator, spaces it, and can say what it is waiting for.
 */
export function AuthLayout() {
  return (
    <AuthCenteredLayout maxWidth={460}>
      <Suspense fallback={<SplashScreen message="Loading sign-in…" />}>
        <Outlet />
      </Suspense>
    </AuthCenteredLayout>
  );
}
