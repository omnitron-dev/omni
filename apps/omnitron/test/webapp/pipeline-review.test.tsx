// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

const { definition, execute } = vi.hoisted(() => ({
  definition: {
    id: 'definition',
    name: 'inspect',
    description: '',
    revision: 'a'.repeat(64),
    triggers: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    steps: [
      {
        name: 'check',
        run: 'echo ready',
        nodeId: 'node-id',
        cwd: '/srv/app',
        retries: 2,
        condition: 'params.enabled',
        env: { MODE: 'inspect' },
      },
    ],
  },
  execute: vi.fn(async () => ({ id: 'run-id' })),
}));
vi.mock('src/netron/client', () => ({
  pipelines: {
    listPipelines: async () => [definition],
    listRuns: async () => [],
    executePipeline: execute,
    getRunStatus: async () => null,
  },
  nodes: { listNodes: async () => [{ id: 'node-id', name: 'edge-a' }] },
}));
vi.mock('src/auth/access', () => ({ Can: ({ children }: { children: React.ReactNode }) => children }));
import PipelinesPage from '../../webapp/src/pages/pipelines.js';

describe('automation review', () => {
  it('shows the target and execution settings and submits the reviewed revision', async () => {
    render(
      <MemoryRouter>
        <PipelinesPage />
      </MemoryRouter>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Run', exact: true }));
    await waitFor(() => expect(screen.getByText(/check · shell · edge-a/)).toBeInTheDocument());
    const settings = screen.getByLabelText('check execution settings');
    expect(settings).toHaveTextContent('/srv/app');
    expect(settings).toHaveTextContent('node-id');
    expect(settings).toHaveTextContent('"retries": 2');
    expect(settings).toHaveTextContent('params.enabled');
    expect(settings).toHaveTextContent('"MODE": "inspect"');
    fireEvent.click(screen.getByRole('button', { name: 'Run automation', exact: true }));
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith({ id: definition.id, expectedRevision: definition.revision, params: {} })
    );
  });
});
