import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { LoadingScreen } from '@omnitron-dev/prism/components/loading-screen';
import { AuthGuard, GuestGuard } from 'src/auth/guard';
import { ConsoleLayout } from 'src/layouts/console-layout';
import { AuthLayout } from 'src/layouts/auth-layout';

// ---------------------------------------------------------------------------
// Lazy pages
// ---------------------------------------------------------------------------

const SignInPage = lazy(() => import('src/pages/auth/sign-in'));
const DashboardPage = lazy(() => import('src/pages/dashboard'));
const AppsListPage = lazy(() => import('src/pages/apps/index'));
const AppDetailPage = lazy(() => import('src/pages/apps/detail'));
const LogsPage = lazy(() => import('src/pages/logs'));
const TopologyPage = lazy(() => import('src/pages/topology'));
const AlertsPage = lazy(() => import('src/pages/alerts'));
const ContainersPage = lazy(() => import('src/pages/containers'));
const DeploymentsPage = lazy(() => import('src/pages/deployments'));
const MetricsPage = lazy(() => import('src/pages/metrics'));
const SettingsPage = lazy(() => import('src/pages/settings'));
const FlowsPage = lazy(() => import('src/pages/flows'));
const PipelinesPage = lazy(() => import('src/pages/pipelines'));
const TracesPage = lazy(() => import('src/pages/traces'));
const DashboardBuilderPage = lazy(() => import('src/pages/dashboard-builder'));
const StacksPage = lazy(() => import('src/pages/stacks/index'));
const StackDetailPage = lazy(() => import('src/pages/stacks/detail'));
const SystemInfoPage = lazy(() => import('src/pages/system-info'));
const NodesPage = lazy(() => import('src/pages/nodes'));
const ProjectsPage = lazy(() => import('src/pages/projects'));
const StudioPage = lazy(() => import('src/pages/studio'));
const AuditPage = lazy(() => import('src/pages/audit'));
const AccessPage = lazy(() => import('src/pages/access'));
const ReleasesPage = lazy(() => import('src/pages/releases/index'));
const ReleaseDetailPage = lazy(() => import('src/pages/releases/detail'));

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const sharedPages = <>
  <Route path="studio" element={<Page><StudioPage /></Page>} />
  <Route path="dashboard-builder" element={<Page><DashboardBuilderPage /></Page>} />
  <Route path="metrics" element={<Page><MetricsPage /></Page>} />
  <Route path="deployments" element={<Page><DeploymentsPage /></Page>} />
  <Route path="logs" element={<Page><LogsPage /></Page>} />
  <Route path="pipelines" element={<Page><PipelinesPage /></Page>} />
  <Route path="flows" element={<Page><FlowsPage /></Page>} />
  <Route path="releases" element={<Page><ReleasesPage /></Page>} />
  <Route path="topology" element={<Page><TopologyPage /></Page>} />
  <Route path="containers" element={<Page><ContainersPage /></Page>} />
</>;

export function Router() {
  return (
    <Routes>
      {/* Auth routes (guest only) */}
      <Route
        element={
          <GuestGuard>
            <AuthLayout />
          </GuestGuard>
        }
      >
        <Route path="/auth/sign-in" element={<Page><SignInPage /></Page>} />
      </Route>

      {/* Protected console routes */}
      <Route
        element={
          <AuthGuard>
            <ConsoleLayout />
          </AuthGuard>
        }
      >
        <Route index element={<Page><DashboardPage /></Page>} />
        <Route path="nodes" element={<Page><NodesPage /></Page>} />
        <Route path="terminal" element={null} />
        <Route path="files" element={null} />
        <Route path="projects" element={<Page><ProjectsPage /></Page>} />
        <Route path="system" element={<Page><SystemInfoPage /></Page>} />
        <Route path="settings" element={<Page><SettingsPage /></Page>} />
        <Route path="alerts" element={<Page><AlertsPage /></Page>} />
        <Route path="audit" element={<Page><AuditPage /></Page>} />
        <Route path="access" element={<Page><AccessPage /></Page>} />
        <Route path="traces" element={<Page><TracesPage /></Page>} />
        <Route path="processes/:name" element={<Page><AppDetailPage /></Page>} />
        {sharedPages}
        <Route path="releases/:id" element={<Page><ReleaseDetailPage /></Page>} />
        <Route path="projects/:project">
          <Route index element={<Page><DashboardPage /></Page>} />
          {sharedPages}
          <Route path="releases/:id" element={<Page><ReleaseDetailPage /></Page>} />
          <Route path="apps" element={<Page><AppsListPage /></Page>} />
          <Route path="apps/:stack/:name" element={<Page><AppDetailPage /></Page>} />
          <Route path="stacks" element={<Page><StacksPage /></Page>} />
          <Route path="stacks/:name" element={<Page><StackDetailPage /></Page>} />
        </Route>

      </Route>

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/** Suspense wrapper for lazy pages */
function Page({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<LoadingScreen />}>{children}</Suspense>;
}
