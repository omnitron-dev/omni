// @vitest-environment happy-dom

/**
 * A stack page that said «Buffering» for ever, and a list that called a
 * reachable node «synced».
 *
 * The stack page read a node's sync chip off `connected` — the push channel
 * no production code opens — so every node said «Buffering», in amber, and
 * the banner summed the entries waiting for the next 15-second pull into
 * «258 items pending sync». The stack list counted the nodes whose daemon
 * answered and wrote «1/1 synced». Both now read `pendingItems` and
 * `lastSyncAt` through `syncFinding`, as `sync-summary.ts` already did.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

import { useProjectStore } from '../../webapp/src/stores/project.store.js';

vi.mock('src/netron/client', () => ({
  project: { listStacks: vi.fn(async () => []) },
  daemon: {},
  nodes: {},
}));
vi.mock('src/netron/release-wire', () => ({
  releaseApi: { list: vi.fn(async () => []), deployments: vi.fn(async () => ({ available: true, rows: [] })) },
}));

const testStack = (lastSyncAgoMs: number) => ({
  name: 'test',
  type: 'remote',
  status: 'running',
  config: { type: 'remote' },
  apps: [],
  infrastructure: { ready: true, services: {} },
  portRange: null,
  startedAt: null,
  uptime: 60_000,
  nodes: [
    {
      host: '37.27.130.185',
      port: 9700,
      role: 'app',
      label: 'test',
      daemonRole: 'slave',
      connected: true,
      lastSeen: Date.now(),
      syncStatus: {
        connected: false,
        lastSyncAt: Date.now() - lastSyncAgoMs,
        pendingItems: 258,
        bufferSize: 258_000,
        lastError: null,
        failedAttempts: 0,
      },
    },
  ],
});

function select(lastSyncAgoMs: number) {
  useProjectStore.setState({
    activeProject: 'daos',
    activeStack: null,
    stacksByProject: { daos: [testStack(lastSyncAgoMs)] as never },
    fetchStacks: vi.fn(async () => undefined) as never,
  });
}

async function renderAt(path: string) {
  const { default: StacksPage } = await import('../../webapp/src/pages/stacks/index.js');
  const { default: StackDetailPage } = await import('../../webapp/src/pages/stacks/detail.js');
  render(
    <ThemeProvider theme={createTheme()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/stacks" element={<StacksPage />} />
          <Route path="/stacks/:name" element={<StackDetailPage />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('a stack page that said buffering for ever', () => {
  it('says a node keeping up is in sync, with what waits for the next pull', async () => {
    select(15_000);
    await renderAt('/stacks/test');

    expect(await screen.findByText('in sync · 258 since the last pull')).toBeInTheDocument();
    expect(screen.getByText(/replication in sync/)).toBeInTheDocument();
    expect(screen.queryByText(/Buffering|items pending sync/)).not.toBeInTheDocument();
  });

  it('says a node is behind when no pull has come', async () => {
    select(300_000);
    await renderAt('/stacks/test');

    expect(await screen.findByText('behind · 258 waiting, last pull 300 s ago')).toBeInTheDocument();
    expect(screen.getByText(/1 of 1 behind/)).toBeInTheDocument();
  });

  it('counts in the list the nodes that keep up, not those whose daemon answered', async () => {
    select(300_000);
    await renderAt('/stacks');

    expect(await screen.findByText(/0\/\s*1 in sync/)).toBeInTheDocument();
    expect(screen.queryByText(/synced/)).not.toBeInTheDocument();
  });
});
