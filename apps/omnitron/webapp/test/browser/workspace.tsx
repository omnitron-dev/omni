import { createRoot } from 'react-dom/client';
import { BrowserRouter, MemoryRouter, Route, Routes } from 'react-router-dom';
import { PrismProvider } from '@omnitron-dev/prism/core';
import { ConsoleAccessProvider } from '../../src/auth/access';
import { useAuthStore } from '../../src/auth/store';
import { ConsoleLayout } from '../../src/layouts/console-layout';
import { omnitronTheme } from '@omnitron-dev/prism/identity';
import { FleetRollout } from '../../src/components/fleet-rollout';
import AuditPage from '../../src/pages/audit';
import StacksPage from '../../src/pages/stacks/index';
import StackDetailPage from '../../src/pages/stacks/detail';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';

const params = new URLSearchParams(location.search);
const view = params.get('view');
const direction = params.get('dir') === 'rtl' ? 'rtl' : 'ltr';
useAuthStore.setState({ user: { id: 'reader', username: 'reader', displayName: 'Reader', role: 'viewer' } });
const workspace = (
      <ConsoleAccessProvider>
        <Routes>
          <Route element={<ConsoleLayout />}>
            <Route path="files" element={null} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="stacks" element={<StacksPage />} />
            <Route path="stacks/:name" element={<StackDetailPage />} />
            <Route index element={view === 'rollout'
              ? <FleetRollout nodes={[]} /> : <div data-testid="content">Project content</div>} />
          </Route>
        </Routes>
      </ConsoleAccessProvider>
);
createRoot(document.getElementById('root')!).render(
  <PrismProvider themeOverrides={omnitronTheme} defaultSettings={{ mode: params.get('mode') === 'light' ? 'light' : 'dark', preset: 'minimal', direction }}>
    {location.pathname === '/workspace.html'
      ? <MemoryRouter initialEntries={[view === 'files' ? '/files' : view === 'audit' ? '/audit' : '/']}>{workspace}</MemoryRouter>
      : <BrowserRouter>{workspace}</BrowserRouter>}
  </PrismProvider>
);
