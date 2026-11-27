// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

const { definition, prepare, execute } = vi.hoisted(() => ({
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
  prepare: vi.fn(async ({ runId }: { runId: string }) => ({ id: runId, status: 'awaiting-review',
    review: { protocol: 1, digest: 'b'.repeat(64), projects: [], parameterNames: [] } })),
  execute: vi.fn(async ({ runId }: { runId: string }) => ({ id: runId, status: 'running' })),
}));
vi.mock('src/netron/client', () => ({
  pipelines: {
    listPipelines: async () => [definition],
    listRuns: async () => [],
    prepareRun: prepare,
    startRun: execute,
    getRunStatus: async () => null,
  },
  nodes: { listNodes: async () => [{ id: 'node-id', name: 'edge-a' }] },
}));
vi.mock('src/auth/access', () => ({ Can: ({ children }: { children: React.ReactNode }) => children,
  useAccess: () => ({ can: () => true }) }));
import PipelinesPage from '../../webapp/src/pages/pipelines.js';
import { PipelineRunDetail } from '../../webapp/src/components/pipeline-run-detail.js';

describe('automation review', () => {
  it('shows a release attempt identity and unconfirmed effects in the existing run detail', () => {
    render(<PipelineRunDetail run={{ id: 'release-run', pipelineId: 'definition', status: 'failed',
      startedAt: '2026-11-12T00:00:00Z', completedAt: '2026-11-12T00:00:01Z', triggeredBy: 'operator', params: {},
      steps: [{ name: 'publish', kind: 'release', status: 'failed', duration: 1000, executions: [{ attempt: 1, state: 'unconfirmed',
        artifact: { releaseId: 'publication-1', manifestSha256: 'a'.repeat(64), artifactSha256: 'b'.repeat(64), producerApp: 'publisher', projectCommit: 'c'.repeat(40), frameworkCommit: 'd'.repeat(40) },
        consumer: { releaseId: 'consumer-1', manifestSha256: 'e'.repeat(64), app: 'publisher' },
        installationRoot: '/installed/verified', treeSha256: 'f'.repeat(64), entry: '/installed/verified/dist/publish.mjs', executable: '/runtime/node',
        cwd: '/operator', environmentSha256: '3'.repeat(64),
        target: { platform: 'linux', arch: 'arm64', node: 'v24.13.0', abi: '137', executableSha256: '1'.repeat(64), libc: '2.39' },
        owner: { id: 'owner-id', pid: 41, epoch: 3, lifetime: 'boot:birth', frameworkCommit: '2'.repeat(40) }, pid: 42,
      }] }],
    }} />);
    expect(screen.getByText(/unconfirmed effects/)).toBeInTheDocument();
    const evidence = screen.getByLabelText('publish release attempt 1');
    expect(evidence).toHaveTextContent('owner-id');
    expect(evidence).toHaveTextContent('boot:birth');
    expect(evidence).toHaveTextContent('/runtime/node');
    expect(evidence).toHaveTextContent('"pid": 42');
  });
  it('distinguishes retained, pending and unresolved work in recovery review', () => {
    render(<PipelineRunDetail run={{ id: 'checkpoint', pipelineId: 'definition', status: 'interrupted',
      startedAt: '2026-11-17T00:00:00Z', completedAt: null, triggeredBy: 'operator', params: {}, steps: [],
      recovery: { digest: 'd'.repeat(64), completed: ['build'], pending: ['verify'], blocked: ['deploy'] },
    }} />);
    expect(screen.getByText(/1 confirmed · 1 awaiting dispatch/)).toHaveTextContent('Continuation blocked by deploy');
  });
  it('shows the target and execution settings and submits the reviewed revision', async () => {
    render(
      <MemoryRouter>
        <PipelinesPage />
      </MemoryRouter>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Run' }));
    await waitFor(() => expect(screen.getByText(/check · shell · edge-a/)).toBeInTheDocument());
    const settings = screen.getByLabelText('check execution settings');
    expect(settings).toHaveTextContent('/srv/app');
    expect(settings).toHaveTextContent('node-id');
    expect(settings).toHaveTextContent('"retries": 2');
    expect(settings).toHaveTextContent('params.enabled');
    expect(settings).toHaveTextContent('"MODE": "inspect"');
    fireEvent.click(screen.getByRole('button', { name: 'Prepare request' }));
    await waitFor(() => expect(prepare).toHaveBeenCalledWith({ runId: expect.any(String),
      id: definition.id, expectedRevision: definition.revision, params: {} }));
    expect(execute).not.toHaveBeenCalled();
    const runId = prepare.mock.calls.at(-1)![0].runId;
    fireEvent.click(await screen.findByRole('button', { name: 'Run automation' }));
    await waitFor(() => expect(execute).toHaveBeenCalledWith({ runId, expectedDigest: 'b'.repeat(64), params: {} }));
  });
});
