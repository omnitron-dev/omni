// @vitest-environment happy-dom

/**
 * A system page that read a section's silence as zero.
 *
 * A section of the daemon's system snapshot that did not answer came back as
 * zeros, empty lists and `docker: null`. The page drew «CPU 0.0%», and no
 * Docker card at all — which reads as «no Docker on this host» — for a Docker
 * that had not answered. The snapshot now names such sections in
 * `unanswered`, and is served with its age while the next is collected.
 */

import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import '@testing-library/jest-dom/vitest';
import { systemInfo } from '../../webapp/src/netron/client.js';
import type { SystemSnapshot } from '../../src/shared/dto/system-info.js';

const snapshot: SystemSnapshot = {
  timestamp: Date.now() - 4_000,
  collectedMs: 2_004,
  unanswered: {
    cpu: 'did not answer within 2000 ms (asked 2 s ago, still out)',
    docker: 'did not answer within 2000 ms (asked 2 s ago, still out)',
  },
  os: {
    platform: 'darwin',
    distro: 'macOS',
    release: '26.4',
    kernel: '25.4.0',
    arch: 'arm64',
    hostname: 'master',
    uptime: 1,
  },
  cpu: {
    manufacturer: '',
    brand: '',
    cores: 0,
    physicalCores: 0,
    speed: 0,
    currentLoad: 0,
    loadPerCore: [],
    temperature: null,
  },
  memory: { total: 100, used: 90, free: 10, available: 40, committed: 60, usedPercent: 60, swapTotal: 0, swapUsed: 0 },
  disks: [],
  network: { interfaces: [], rxSec: 0, txSec: 0 },
  docker: null,
  daemon: {
    role: 'master',
    pid: 30867,
    nodeVersion: 'v24',
    v8Version: '13',
    uptimeMs: 1,
    memoryUsage: { rss: 1, heapTotal: 1, heapUsed: 1, external: 1 },
  },
};

vi.mock('src/netron/client', () => ({
  systemInfo: { getSnapshot: vi.fn(async () => snapshot) },
}));

describe('a system page that read silence as zero', () => {
  afterEach(cleanup);

  it('says which sections did not answer, keeps the Docker card, and shows no zero for them', async () => {
    const { default: SystemInfoPage } = await import('../../webapp/src/pages/system-info.js');
    render(
      <ThemeProvider theme={createTheme()}>
        <MemoryRouter>
          <SystemInfoPage />
        </MemoryRouter>
      </ThemeProvider>
    );

    expect(await screen.findByText('Docker')).toBeInTheDocument();
    expect(screen.getAllByText(/Did not answer — did not answer within 2000 ms/)).toHaveLength(2);
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument();
    expect(screen.getByText(/Collected \d+ s ago in 2004 ms/)).toBeInTheDocument();
  });

  it('opens device evidence even when the mount inventory is unavailable', async () => {
    vi.mocked(systemInfo.getSnapshot).mockResolvedValueOnce({
      ...snapshot,
      unanswered: { disks: 'Mount inventory timed out' },
      storage: {
        status: 'degraded',
        resources: [
          { kind: 'array', name: 'md0', health: 'degraded', detail: 'RAID1 · 1 member missing' },
          { kind: 'controller', name: 'nvme1', health: 'degraded', detail: 'dead' },
        ],
        issues: [],
      },
    });
    const { default: SystemInfoPage } = await import('../../webapp/src/pages/system-info.js');
    render(<ThemeProvider theme={createTheme()}><MemoryRouter><SystemInfoPage /></MemoryRouter></ThemeProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect storage' }));
    expect(await screen.findByRole('heading', { name: 'Storage hardware' })).toBeVisible();
    expect(screen.getByText('md0')).toBeVisible();
    expect(screen.getByText('dead')).toBeVisible();
    expect(screen.getByText('Mount inventory unavailable.')).toBeVisible();
  });

  it('identifies an older daemon that only reports filesystem capacity', async () => {
    const { default: SystemInfoPage } = await import('../../webapp/src/pages/system-info.js');
    render(
      <ThemeProvider theme={createTheme()}>
        <MemoryRouter initialEntries={['/system?view=storage']}><SystemInfoPage /></MemoryRouter>
      </ThemeProvider>
    );
    expect(await screen.findByText('This daemon does not report storage hardware health.')).toBeVisible();
    expect(screen.getByText('No mounted filesystems reported.')).toBeVisible();
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
  });
});
