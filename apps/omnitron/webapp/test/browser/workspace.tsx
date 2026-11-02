import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PrismProvider } from '@omnitron-dev/prism/core';
import { ConsoleAccessProvider } from '../../src/auth/access';
import { useAuthStore } from '../../src/auth/store';
import { ConsoleLayout } from '../../src/layouts/console-layout';
import { consoleTheme } from '../../src/theme';

const direction = new URLSearchParams(location.search).get('dir') === 'rtl' ? 'rtl' : 'ltr';
useAuthStore.setState({ user: { id: 'reader', username: 'reader', displayName: 'Reader', role: 'viewer' } });
createRoot(document.getElementById('root')!).render(
  <PrismProvider themeOverrides={consoleTheme} defaultSettings={{ mode: 'dark', preset: 'midnight', direction }}>
    <MemoryRouter>
      <ConsoleAccessProvider>
        <Routes>
          <Route element={<ConsoleLayout />}>
            <Route index element={<div data-testid="content">Project content</div>} />
          </Route>
        </Routes>
      </ConsoleAccessProvider>
    </MemoryRouter>
  </PrismProvider>
);
