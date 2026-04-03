import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { LoadingScreen } from '@omnitron-dev/prism';
import { AuthGuard, GuestGuard } from 'src/auth/guard';
import { ProjectGuard } from 'src/auth/project-guard';
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
const PipelinesPage = lazy(() => import('src/pages/pipelines'));
const TracesPage = lazy(() => import('src/pages/traces'));
const DashboardBuilderPage = lazy(() => import('src/pages/dashboard-builder'));
const StacksPage = lazy(() => import('src/pages/stacks/index'));
const StackDetailPage = lazy(() => import('src/pages/stacks/detail'));
const SystemInfoPage = lazy(() => import('src/pages/system-info'));
const NodesPage = lazy(() => import('src/pages/nodes'));

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

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
        {/* Always accessible — no project required */}
        <Route index element={<Page><DashboardPage /></Page>} />
        <Route path="nodes" element={<Page><NodesPage /></Page>} />
        <Route path="system" element={<Page><SystemInfoPage /></Page>} />
        <Route path="settings" element={<Page><SettingsPage /></Page>} />
        <Route path="logs" element={<Page><LogsPage /></Page>} />

        {/* Project-scoped — redirect to / if no active project */}
        <Route path="apps" element={<ProjectRoute><AppsListPage /></ProjectRoute>} />
        <Route path="apps/:name" element={<ProjectRoute><AppDetailPage /></ProjectRoute>} />
        <Route path="stacks" element={<ProjectRoute><StacksPage /></ProjectRoute>} />
        <Route path="stacks/:name" element={<ProjectRoute><StackDetailPage /></ProjectRoute>} />
        <Route path="metrics" element={<ProjectRoute><MetricsPage /></ProjectRoute>} />
        <Route path="topology" element={<ProjectRoute><TopologyPage /></ProjectRoute>} />
        <Route path="containers" element={<ProjectRoute><ContainersPage /></ProjectRoute>} />
        <Route path="deployments" element={<ProjectRoute><DeploymentsPage /></ProjectRoute>} />
        <Route path="alerts" element={<ProjectRoute><AlertsPage /></ProjectRoute>} />
        <Route path="pipelines" element={<ProjectRoute><PipelinesPage /></ProjectRoute>} />
        <Route path="traces" element={<ProjectRoute><TracesPage /></ProjectRoute>} />
        <Route path="dashboard-builder" element={<ProjectRoute><DashboardBuilderPage /></ProjectRoute>} />

        {/* Legacy redirects */}
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

/** Project-scoped route: Suspense + ProjectGuard */
function ProjectRoute({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <ProjectGuard>{children}</ProjectGuard>
    </Suspense>
  );
}
