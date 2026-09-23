// @vitest-environment happy-dom

/**
 * A stack that started when the master did.
 *
 * A remote stack's «Started» was the moment this master attached to it after
 * its own restart: on 2026-09-23 the test stack read «Started 16:03:46,
 * Uptime 25m» beside six apps its node reported up for 68 minutes. Since
 * b4c8ed04 the daemon says both — `startedAt` from the nodes, `attachedAt`
 * for this master — and the page shows them apart.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

import { useProjectStore } from '../../webapp/src/stores/project.store.js';

vi.mock('src/netron/client', () => ({ project: { listStacks: vi.fn(async () => []) }, daemon: {}, nodes: {} }));
vi.mock('src/netron/release-wire', () => ({
  releaseApi: { list: vi.fn(async () => []), deployments: vi.fn(async () => ({ available: true, rows: [] })) },
}));

const STARTED = '2026-09-23T12:20:48.966Z';
const ATTACHED = '2026-09-23T13:03:46.367Z';

const stack = (name: string, type: 'local' | 'remote', startedAt: string | null, attachedAt: string | null) => ({
  name,
  type,
  status: 'running',
  config: { type },
  apps: [],
  nodes: [],
  infrastructure: { ready: true, services: {} },
  portRange: null,
  startedAt,
  uptime: startedAt ? 4_080_000 : 0,
  attachedAt,
});

async function renderStack(info: ReturnType<typeof stack>) {
  useProjectStore.setState({
    activeProject: 'daos',
    activeStack: null,
    stacksByProject: { daos: [info] as never },
    fetchStacks: vi.fn(async () => undefined) as never,
  });
  const { default: StackDetailPage } = await import('../../webapp/src/pages/stacks/detail.js');
  render(
    <ThemeProvider theme={createTheme()}>
      <MemoryRouter initialEntries={[`/stacks/${info.name}`]}>
        <Routes>
          <Route path="/stacks/:name" element={<StackDetailPage />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  );
}

describe('a stack that started when the master did', () => {
  it("shows a remote stack's start as its nodes report it, and when this master attached, apart", async () => {
    await renderStack(stack('test', 'remote', STARTED, ATTACHED));

    expect(await screen.findByText(`${new Date(STARTED).toLocaleString()}, as its nodes report`)).toBeInTheDocument();
    expect(screen.getByText(`${new Date(ATTACHED).toLocaleString()} — by this master`)).toBeInTheDocument();
  });

  it('says a remote start is unknown rather than borrowing the attach time', async () => {
    await renderStack(stack('test', 'remote', null, ATTACHED));

    expect(await screen.findByText('unknown — no node reported an app of it running')).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(`^${new Date(ATTACHED).toLocaleString()}, as its`))).not.toBeInTheDocument();
  });

  it('gives a local stack no attach time — this daemon runs it', async () => {
    await renderStack(stack('dev', 'local', STARTED, null));

    expect(await screen.findByText(new Date(STARTED).toLocaleString())).toBeInTheDocument();
    expect(screen.queryByText('Attached')).not.toBeInTheDocument();
  });
});
