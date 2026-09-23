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

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import '@testing-library/jest-dom/vitest';

const snapshot = {
  timestamp: Date.now() - 4_000,
  collectedMs: 2_004,
  unanswered: {
    cpu: 'did not answer within 2000 ms (asked 2 s ago, still out)',
    docker: 'did not answer within 2000 ms (asked 2 s ago, still out)',
  },
  os: { platform: 'darwin', distro: 'macOS', release: '26.4', kernel: '25.4.0', arch: 'arm64', hostname: 'master', uptime: 1 },
  cpu: { manufacturer: '', brand: '', cores: 0, physicalCores: 0, speed: 0, currentLoad: 0, loadPerCore: [], temperature: null },
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
  it('says which sections did not answer, keeps the Docker card, and shows no zero for them', async () => {
    const { default: SystemInfoPage } = await import('../../webapp/src/pages/system-info.js');
    render(
      <ThemeProvider theme={createTheme()}>
        <SystemInfoPage />
      </ThemeProvider>,
    );

    expect(await screen.findByText('Docker')).toBeInTheDocument();
    expect(screen.getAllByText(/Did not answer — did not answer within 2000 ms/)).toHaveLength(2);
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument();
    expect(screen.getByText(/Collected \d+ s ago in 2004 ms/)).toBeInTheDocument();
  });
});
