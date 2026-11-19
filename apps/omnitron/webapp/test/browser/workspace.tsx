import { App } from '../../src/app';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PrismProvider } from '@omnitron-dev/prism/core';
import { SnackbarProvider } from '@omnitron-dev/prism/components/snackbar';
import { ConsoleAccessProvider } from '../../src/auth/access';
import { useAuthStore } from '../../src/auth/store';
import { ConsoleLayout } from '../../src/layouts/console-layout';
import { omnitronTheme } from '@omnitron-dev/prism/identity';
import { FleetRollout } from '../../src/components/fleet-rollout';
import AuditPage from '../../src/pages/audit';
import DashboardPage from '../../src/pages/dashboard';
import LogsPage from '../../src/pages/logs';
import PipelinesPage from '../../src/pages/pipelines';
import ProjectsPage from '../../src/pages/projects';
import StudioPage from '../../src/pages/studio';
import StacksPage from '../../src/pages/stacks/index';
import StackDetailPage from '../../src/pages/stacks/detail';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';

const params = new URLSearchParams(location.search);
const view = params.get('view');
const direction = params.get('dir') === 'rtl' ? 'rtl' : 'ltr';
const account = (window as Window & { fixtureAccount?: string }).fixtureAccount ?? 'reader';
useAuthStore.setState({ user: { id: account, username: account, displayName: account === 'reader' ? 'Reader' : account, role: 'viewer' }, initialized: true });
const workspace = (
      <ConsoleAccessProvider>
        <SnackbarProvider><Routes>
          <Route element={<ConsoleLayout />}>
            <Route path="files" element={null} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="logs" element={<LogsPage />} />
            <Route path="pipelines" element={<PipelinesPage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="studio" element={<StudioPage />} />
            <Route path="stacks" element={<StacksPage />} />
            <Route path="stacks/:name" element={<StackDetailPage />} />
            <Route path="projects/:project" element={view === 'dashboard' ? <DashboardPage /> : <div data-testid="content">Project content</div>} />
            <Route index element={view === 'dashboard' ? <DashboardPage /> : view === 'rollout'
              ? <FleetRollout nodes={[]} /> : <div data-testid="content">Project content</div>} />
          </Route>
        </Routes></SnackbarProvider>
      </ConsoleAccessProvider>
);
createRoot(document.getElementById('root')!).render(
  location.pathname !== '/workspace.html' ? <App /> : <PrismProvider mode={params.has('mode') ? (params.get('mode') === 'light' ? 'light' : 'dark') : undefined}
    themeOverrides={omnitronTheme} defaultSettings={{ mode: 'dark', preset: 'minimal', direction }}>
    <MemoryRouter initialEntries={[params.get('path') ?? (view === 'files' ? '/files' : view === 'audit' ? '/audit' : '/')]}>{workspace}</MemoryRouter>
  </PrismProvider>
);
