import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { AuthCenteredLayout } from '@omnitron-dev/prism/layouts';
import { OmnitronSplash } from '@omnitron-dev/prism/identity';
import { DaemonOfflineBanner } from 'src/components/daemon-offline-banner';
import { ConsoleUpdateBanner } from 'src/components/console-update-banner';

/** The sign-in route uses the same calm, named activity state as session validation. */
export function AuthLayout() {
  return (
    <AuthCenteredLayout maxWidth={460}>
      <DaemonOfflineBanner />
      <ConsoleUpdateBanner />
      <Suspense fallback={<OmnitronSplash message="Loading sign-in…" />}>
        <Outlet />
      </Suspense>
    </AuthCenteredLayout>
  );
}
