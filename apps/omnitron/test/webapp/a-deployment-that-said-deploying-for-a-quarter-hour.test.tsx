// @vitest-environment happy-dom

/**
 * A deployment published its every step and the console could not see one.
 *
 * `RemoteDeployer.emitProgress` fires for each phase of each app on each node
 * — connecting, transferring, unpacking, installing, starting, verifying —
 * and `ProjectService` re-emits them as `stack:deploy_progress`. The console
 * has no event subscription at all; every page in it polls. So the events
 * went to a handler that published them to nobody, and the deployments page
 * showed one row whose status read `deploying` from the first second to the
 * last.
 *
 * That matters most exactly when it goes wrong. Installing dependencies on a
 * node takes minutes, and a deployment stuck there is indistinguishable from
 * one that is working — which is the state an operator watched for a quarter
 * of an hour, twice, while the actual failure
 *
 *     dependency install failed on the node: npm error Cannot read
 *     properties of null (reading 'edgesOut')
 *
 * sat in a `message` field with no reader.
 *
 * The fix is a place for an event to wait: the deployer keeps the last one
 * per node and app, an RPC hands them over, and the page polls it. These pin
 * the reading rules the panel turns on.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import '@testing-library/jest-dom/vitest';

import { DeployProgressList, isInFlight, ago } from '../../webapp/src/components/deploy-progress';

type Record_ = Parameters<typeof DeployProgressList>[0]['records'][number];

const at = '2026-09-20T07:45:00.000Z';
const NOW = new Date('2026-09-20T07:45:30.000Z').getTime();

const record = (over: Partial<Record_> = {}): Record_ =>
  ({
    node: '37.27.130.185:9700',
    app: 'main',
    status: 'installing',
    progress: 60,
    message: 'Installing dependencies on the node...',
    at,
    ...over,
  }) as Record_;

const draw = (records: Record_[]) =>
  render(
    <ThemeProvider theme={createTheme()}>
      <DeployProgressList records={records} now={NOW} />
    </ThemeProvider>,
  );

describe('a phase that is running is not a phase that is done', () => {
  it('counts every phase before success or failure as in flight', () => {
    for (const status of ['pending', 'transferring', 'extracting', 'installing', 'restarting', 'verifying'] as const) {
      expect(isInFlight(status)).toBe(true);
    }
  });

  it('counts the two that have stopped as not', () => {
    expect(isInFlight('success')).toBe(false);
    expect(isInFlight('failed')).toBe(false);
  });
});

describe('the panel says which phase, not just that something is happening', () => {
  it('names the phase an operator is waiting on', () => {
    // The whole point. `deploying` for fifteen minutes and
    // `Installing dependencies on the node` for fifteen minutes are the same
    // duration and completely different information: the second says the
    // wait is expected and where it is being spent.
    draw([record({ status: 'installing' })]);
    expect(screen.getByText('Installing dependencies on the node')).toBeInTheDocument();
  });

  it('distinguishes the phases that used to share one word', () => {
    draw([
      record({ app: 'main', status: 'transferring' }),
      record({ app: 'geo', status: 'installing' }),
      record({ app: 'storage', status: 'verifying' }),
    ]);

    expect(screen.getByText('Transferring artifact')).toBeInTheDocument();
    expect(screen.getByText('Installing dependencies on the node')).toBeInTheDocument();
    expect(screen.getByText('Verifying')).toBeInTheDocument();
  });

  it('shows the message on a success as well as a failure', () => {
    // Not only on failure: the message is the only field that says WHY, and
    // an operator reading a successful deployment still wants to know what
    // the daemon thinks it did.
    draw([record({ status: 'success', message: 'Installed' })]);
    expect(screen.getByText('Installed')).toBeInTheDocument();
  });

  it('shows the failure message, which is where the reason lives', () => {
    const reason =
      'the installed tree cannot resolve @omnitron-dev/omnitron, so the app will fail at its first import';
    draw([record({ status: 'failed', message: reason })]);

    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText(reason)).toBeInTheDocument();
  });

  it('names the node, because an app can be deploying to several', () => {
    draw([
      record({ app: 'main', node: '10.0.0.1:9700' }),
      record({ app: 'main', node: '10.0.0.2:9700' }),
    ]);

    expect(screen.getByText('10.0.0.1:9700')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.2:9700')).toBeInTheDocument();
  });

  it('counts what is still in flight, and only that', () => {
    draw([
      record({ app: 'main', status: 'installing' }),
      record({ app: 'geo', status: 'success' }),
      record({ app: 'storage', status: 'failed' }),
    ]);

    expect(screen.getByText('1 in flight')).toBeInTheDocument();
  });

  it('says nothing when there is nothing to say', () => {
    // An empty panel headed "Deployment progress" on a console where nobody
    // is deploying is a widget to be scrolled past forever.
    const { container } = draw([]);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('how long ago, at the scale the answer is good to', () => {
  it('rounds rather than inviting a reading it cannot support', () => {
    expect(ago('2026-09-20T07:45:28.000Z', NOW)).toBe('just now');
    expect(ago('2026-09-20T07:45:00.000Z', NOW)).toBe('30s ago');
    expect(ago('2026-09-20T07:41:30.000Z', NOW)).toBe('4m ago');
    expect(ago('2026-09-20T05:45:30.000Z', NOW)).toBe('2h ago');
  });

  it('does not report a clock skew as the future', () => {
    // A node's timestamp is the MASTER's here, but a clock that moved
    // backwards would otherwise render "-3s ago", which reads as a bug in
    // this panel rather than in the clock.
    expect(ago('2026-09-20T07:46:00.000Z', NOW)).toBe('just now');
  });
});
