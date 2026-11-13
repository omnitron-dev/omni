// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { IStackInfo, IStackInfraStatus } from '../../src/shared/dto/project.js';
import { stackFixture } from '../helpers/stack-fixture.js';
import { StackInfrastructure } from '../../webapp/src/components/stack-infrastructure.js';

afterEach(cleanup);

function placement(host: string, infrastructure: IStackInfraStatus | null): NonNullable<IStackInfo['placements']>[number] {
  return { nodeKey: host + ':9700', host, port: 9700, label: null, observedAt: infrastructure ? '2026-11-12T08:00:00Z' : null,
    appsObserved: true, infrastructureObserved: infrastructure !== null, apps: [], infrastructure,
    errors: infrastructure ? [] : ['Node did not return an infrastructure inventory'] };
}

it('shows configured databases, bucket names and named ports without claiming unobserved services stopped', () => {
  const stack = stackFixture('dev', { config: { type: 'local', infrastructure: {
    postgres: { databases: { payments: { migrate: true, password: 'db-secret' } }, password: 'pg-secret' },
    redis: { databases: { 'messaging:jobs': 3 } }, minio: { buckets: ['uploads'], secretKey: 's3-secret' },
    services: { queue: { preset: 'nats', ports: { telemetry: 8222 } },
      snapshots: { preset: 'minio', config: { buckets: ['reports'] }, secrets: { private: 'token-secret' } } },
  }, serviceOverrides: { 'worker/receipts': { external: { host: 'cache.internal', ports: { main: 6020 }, secrets: { key: 'remote-secret' } } } } } });
  const { container } = render(<StackInfrastructure stack={stack} />);
  expect(screen.getByText('No infrastructure observations for this stack.')).toBeInTheDocument();
  expect(container.textContent).toContain('payments (migrations)');
  expect(container.textContent).toContain('messaging:jobs · DB 3');
  expect(container.textContent).toContain('api → 9000, console → 9001');
  expect(container.textContent).toContain('telemetry → 8222');
  expect(container.textContent).toContain('reports');
  expect(container.textContent).toContain('cache.internal');
  expect(screen.getAllByText('Not observed')).toHaveLength(6);
  expect(container.textContent).not.toMatch(/stopped|db-secret|pg-secret|s3-secret|token-secret|remote-secret/i);
});

it('keeps same-name services on separate nodes and differentiates unavailable and observed-empty inventories', () => {
  const service: IStackInfraStatus['services'][string] = { service: 'queue', app: 'jobs', containerName: 'sample-test-queue',
    status: 'running', containerId: 'b'.repeat(64), port: 4222, ports: { '4222/tcp': 14222 }, health: 'healthy', provisioning: 'ready', image: 'nats:2' };
  const stack = stackFixture('test', { type: 'cluster', config: { type: 'cluster' },
    placements: [placement('worker-a', { ready: true, services: { queue: service } }),
      placement('worker-b', { ready: false, services: { queue: { ...service, status: 'error', health: 'none', provisioning: 'failed', error: 'Cannot initialize stream' } } }),
      placement('worker-c', null), placement('worker-d', { ready: true, services: {} })],
    infrastructure: { ready: true, services: { stale: { ...service, service: 'stale-controller-copy' } } } });
  render(<StackInfrastructure stack={stack} />);
  const a = within(screen.getByRole('region', { name: 'worker-a:9700' }));
  const b = within(screen.getByRole('region', { name: 'worker-b:9700' }));
  expect(a.getByText('queue')).toBeInTheDocument();
  expect(a.getByText('Setup ready')).toBeInTheDocument();
  expect(a.getByText(/4222\/tcp → 14222/).textContent).toContain('bbbbbbbbbbbb');
  expect(b.getByText('Setup failed')).toBeInTheDocument();
  expect(b.getByText('Cannot initialize stream')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'worker-c:9700' })).getByText(/Node did not return/)).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'worker-d:9700' })).getByText('No services reported.')).toBeInTheDocument();
  expect(screen.queryByText('stale-controller-copy')).not.toBeInTheDocument();
});

it('shows observed-only stack containers and preserves node attribution from older inventories', () => {
  const stack = stackFixture('test', { type: 'remote', config: { type: 'remote' },
    infrastructure: { ready: false, services: { index: { status: 'stopped', containerName: 'sample-test-index', nodeKey: 'data:9700', port: null } } } });
  render(<StackInfrastructure stack={stack} />);
  expect(screen.getByRole('list', { name: 'Services on data:9700' })).toHaveTextContent('sample-test-index');
  expect(screen.getByText('stopped')).toBeInTheDocument();
  expect(screen.queryByText('Not observed')).not.toBeInTheDocument();
});
