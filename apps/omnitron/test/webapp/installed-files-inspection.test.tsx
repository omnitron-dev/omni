// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('src/netron/client', () => ({ daemonClient: { invoke: mocks.invoke } }));
const { InstalledFilesInspection } = await import('../../webapp/src/components/installed-files-inspection');
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('inspects only on demand, gives progress feedback, and labels a modified installed base without verifying a launch', async () => {
  let finish!: (value: unknown) => void;
  mocks.invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<MemoryRouter><InstalledFilesInspection project="sample" stack="test" /></MemoryRouter>);
  expect(mocks.invoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Inspect installed files' }));
  expect(screen.getByRole('status')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Inspect installed files' }) as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.invoke).toHaveBeenCalledWith('daemon', 'OmnitronProject', 'inspectInstalledArtifacts', [{ project: 'sample', stack: 'test' }], { timeout: 90000 });
  finish({ project: 'sample', stack: 'test', observedAt: '2026-11-02T00:00:00Z', catalogComplete: true, catalogReasons: [], nodes: [],
    limitations: ['Installed files were inspected now; this does not prove what a running process loaded.'],
    apps: [{ app: 'sample/deployed/main', node: 'test-node', pid: 123, observedAt: '2026-11-02T00:00:00Z', state: 'observed', reasons: [],
      candidates: [{ releaseId: 'sample-base', state: 'modified', reasons: ['Installed entry point differs from the retained release archive'] }] }] });
  await waitFor(() => expect(screen.getByText(/Installed files modified/)).toBeTruthy());
  expect(screen.getByRole('link', { name: 'sample-base', hidden: true }).getAttribute('href')).toBe('/releases/sample-base');
  expect(screen.queryByText('Launch release verified')).toBeNull();
  expect(screen.getByText(/does not prove what a running process loaded/)).toBeTruthy();
  expect(screen.queryByRole('status')).toBeNull();
});

it('preserves an unavailable old-backend result as an explicit failure', async () => {
  mocks.invoke.mockRejectedValue(new Error('Method not found'));
  render(<MemoryRouter><InstalledFilesInspection project="sample" stack="test" /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect installed files' }));
  await waitFor(() => expect(screen.getByText(/Inspection is unavailable/)).toBeTruthy());
  expect(screen.queryByText(/No catalog match/)).toBeNull();
  expect((screen.getByRole('button', { name: 'Inspect installed files' }) as HTMLButtonElement).disabled).toBe(false);
});
