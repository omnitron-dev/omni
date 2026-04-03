/**
 * Prism E2E Test Application
 *
 * A minimal Vite application for testing Prism components.
 * Each route renders a specific component scenario for E2E tests.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

import { createPrismTheme } from '../../src/theme';
import { DialogTestPage } from './pages/dialog';
import { DashboardBlockTestPage } from './pages/dashboard-block';
import { FormTestPage } from './pages/form';
import { NavigationTestPage } from './pages/navigation';
import { MenuTestPage } from './pages/menu';
import { TabsTestPage } from './pages/tabs';
import { SnackbarTestPage } from './pages/snackbar';
import { ColorsTestPage } from './pages/colors';
import { AnimationsTestPage } from './pages/animations';
import { ButtonsTestPage } from './pages/buttons';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/test/dialog" element={<DialogTestPage />} />
        <Route path="/test/dashboard-block" element={<DashboardBlockTestPage />} />
        <Route path="/test/form" element={<FormTestPage />} />
        <Route path="/test/navigation" element={<NavigationTestPage />} />
        <Route path="/test/menu" element={<MenuTestPage />} />
        <Route path="/test/tabs" element={<TabsTestPage />} />
        <Route path="/test/snackbar" element={<SnackbarTestPage />} />
        <Route path="/test/colors" element={<ColorsTestPage />} />
        <Route path="/test/animations" element={<AnimationsTestPage />} />
        <Route path="/test/buttons" element={<ButtonsTestPage />} />
        <Route
          path="/"
          element={
            <div style={{ padding: 20 }}>
              <h1>Prism E2E Test Application</h1>
              <p>Navigate to a test route to view components.</p>
              <ul>
                <li>
                  <a href="/test/dialog">Dialog Tests</a>
                </li>
                <li>
                  <a href="/test/dashboard-block">Dashboard Block Tests</a>
                </li>
                <li>
                  <a href="/test/form">Form Tests</a>
                </li>
                <li>
                  <a href="/test/navigation">Navigation Tests</a>
                </li>
                <li>
                  <a href="/test/menu">Menu Tests</a>
                </li>
                <li>
                  <a href="/test/tabs">Tabs Tests</a>
                </li>
                <li>
                  <a href="/test/snackbar">Snackbar Tests</a>
                </li>
                <li>
                  <a href="/test/colors">Color Contrast Tests</a>
                </li>
                <li>
                  <a href="/test/animations">Animation Tests</a>
                </li>
                <li>
                  <a href="/test/buttons">Button Tests</a>
                </li>
              </ul>
            </div>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

function Root() {
  const theme = createPrismTheme({ mode: 'light' });

  return (
    <StrictMode>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <App />
      </ThemeProvider>
    </StrictMode>
  );
}

createRoot(document.getElementById('root')!).render(<Root />);
