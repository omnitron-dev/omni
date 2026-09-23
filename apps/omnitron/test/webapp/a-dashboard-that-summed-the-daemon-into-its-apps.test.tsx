// @vitest-environment happy-dom

/**
 * A dashboard that summed the daemon into its apps' memory.
 *
 * The dashboard builder's default «CPU» and «Memory» cards read the daemon's
 * `totalCpu` and `totalMemory`. The first is the apps' CPU; the second is the
 * apps' memory plus the daemon's own RSS. On the master (2026-09-23) they read
 * «41.9%» — six apps — beside «2074.8 MB»: the six apps' 1781.8 and the
 * daemon's 293.0, which the Daemon card on the same dashboard shows again.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

const { status, apps } = vi.hoisted(() => {
  const MB = 1024 * 1024;
  const apps = [
    {
      name: 'daos/dev/main',
      status: 'online',
      cpu: 30,
      memory: 1_000 * MB,
      restarts: 0,
      pid: 1,
      uptime: 1,
      instances: 1,
      port: 3001,
    },
    {
      name: 'daos/dev/paysys',
      status: 'online',
      cpu: 11.9,
      memory: 781.8 * MB,
      restarts: 0,
      pid: 2,
      uptime: 1,
      instances: 1,
      port: 3004,
    },
  ];
  return {
    apps,
    status: {
      apps,
      totalCpu: 41.9,
      totalMemory: 2_074.8 * MB,
      appsMemory: 1_781.8 * MB,
      daemonMemory: 293 * MB,
      uptime: 60_000,
      pid: 52285,
      version: '0.2.0',
    },
  };
});

vi.mock('react-apexcharts', () => ({ default: () => null }));
vi.mock('src/netron/client', () => ({
  daemon: { status: vi.fn(async () => status), list: vi.fn(async () => apps) },
}));

describe('a dashboard that summed the daemon into its apps', () => {
  it("shows the apps' memory beside the apps' CPU, and the daemon's apart", async () => {
    const { default: DashboardBuilderPage } = await import('../../webapp/src/pages/dashboard-builder.js');
    render(
      <ThemeProvider theme={createTheme()}>
        <MemoryRouter>
          <DashboardBuilderPage />
        </MemoryRouter>
      </ThemeProvider>
    );

    expect(await screen.findByText('41.9%')).toBeInTheDocument();
    expect(screen.getByText('1781.8 MB')).toBeInTheDocument();
    expect(screen.queryByText('2074.8 MB')).not.toBeInTheDocument();
    expect(screen.getByText('293.0 MB')).toBeInTheDocument();
  });
});
