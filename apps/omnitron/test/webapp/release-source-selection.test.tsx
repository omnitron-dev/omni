// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReleasePreflightView } from '../../webapp/src/netron/release-wire';

const mocks = vi.hoisted(() => ({ build: vi.fn(), fetchStacks: vi.fn(), snapshot: { role: 'admin' } as { role: string } | null }));
vi.mock('src/netron/client', () => ({ releases: { build: mocks.build } }));
vi.mock('src/auth/access', () => ({ useAccess: () => ({ snapshot: mocks.snapshot }) }));
vi.mock('src/stores/project.store', () => {
  const state = { projects: [{ name: 'sample' }], stacksByProject: { sample: [] }, fetchStacks: mocks.fetchStacks };
  return { useProjectStore: (select: (value: typeof state) => unknown) => select(state) };
});
const { default: BuildReleaseDialog } = await import('../../webapp/src/pages/releases/build-release-dialog');
const preflight: ReleasePreflightView = { root: '/private/releases', canBuild: true, missingTools: [], path: [], load: [0, 0, 0], cpus: 2, frameworkSource: 1 };
const props = () => ({ open: true, onClose: vi.fn(), onStarted: vi.fn(), defaultProject: 'sample', preflight });
beforeEach(() => { mocks.snapshot = { role: 'admin' }; mocks.build.mockResolvedValue({ buildId: 'private-build' }); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const submit = () => screen.getByRole('button', { name: 'Build', exact: true });
function sourceOptions() { fireEvent.click(screen.getByRole('button', { name: /SDK source/ })); }

it('leaves source selection to the committed project when no override was requested', async () => {
  const p = props();
  render(<BuildReleaseDialog {...p} />);
  fireEvent.click(submit());
  await waitFor(() => expect(p.onStarted).toHaveBeenCalled());
  expect(mocks.build).toHaveBeenCalledWith({ project: 'sample' });
});

it('sends an arbitrary Git host and its explicit ref through the shared build request', async () => {
  render(<BuildReleaseDialog {...props()} />);
  sourceOptions();
  fireEvent.change(screen.getByLabelText('SDK repository'), { target: { value: 'ssh://git@forge.example/platform/omni.git' } });
  fireEvent.change(screen.getByLabelText('Required source ref (optional)'), { target: { value: 'refs/heads/production' } });
  fireEvent.click(submit());
  await waitFor(() => expect(mocks.build).toHaveBeenCalledWith({ project: 'sample', frameworkSource: { repository: 'ssh://git@forge.example/platform/omni.git', ref: 'refs/heads/production' } }));
});

it('rejects credentials before the request and does not echo them in the error', () => {
  render(<BuildReleaseDialog {...props()} />);
  sourceOptions();
  fireEvent.change(screen.getByLabelText('SDK repository'), { target: { value: 'https://secret-token@git.example/omni.git' } });
  expect(submit().hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('alert').textContent).not.toContain('secret-token');
  fireEvent.click(submit());
  expect(mocks.build).not.toHaveBeenCalled();
});

it('never sends a source override to a controller that has not advertised support', () => {
  const p = props();
  const { frameworkSource: _capability, ...legacy } = preflight;
  const view = render(<BuildReleaseDialog {...p} preflight={legacy} />);
  sourceOptions();
  expect(screen.getByLabelText('SDK repository').hasAttribute('disabled')).toBe(true);
  view.rerender(<BuildReleaseDialog {...p} />);
  fireEvent.change(screen.getByLabelText('SDK repository'), { target: { value: '/srv/mirrors/omni.git' } });
  view.rerender(<BuildReleaseDialog {...p} preflight={legacy} />);
  expect(submit().hasAttribute('disabled')).toBe(true);
  fireEvent.click(submit());
  expect(mocks.build).not.toHaveBeenCalled();
});

it.each(['operator', 'viewer', null])('does not offer an SDK override without current administrator access (%s)', (role) => {
  mocks.snapshot = role ? { role } : null;
  render(<BuildReleaseDialog {...props()} />);
  sourceOptions();
  expect(screen.getByLabelText('SDK repository').hasAttribute('disabled')).toBe(true);
  expect(screen.getByText(/Selecting another SDK source requires administrator access/)).toBeTruthy();
});

it('keeps an operator build on the registered project defaults', async () => {
  mocks.snapshot = { role: 'operator' };
  render(<BuildReleaseDialog {...props()} />);
  fireEvent.click(submit());
  await waitFor(() => expect(mocks.build).toHaveBeenCalledWith({ project: 'sample' }));
  expect(screen.getByLabelText('Environment for the gates').hasAttribute('disabled')).toBe(true);
});

it('allows an administrator to submit environment overrides', async () => {
  render(<BuildReleaseDialog {...props()} />);
  fireEvent.change(screen.getByLabelText('Environment for the gates'), { target: { value: 'TEST_PORT=45432' } });
  fireEvent.click(submit());
  await waitFor(() => expect(mocks.build).toHaveBeenCalledWith({ project: 'sample', env: { TEST_PORT: '45432' } }));
});

it('refuses prepared environment overrides after role loss and resets them when reopened', async () => {
  const p = props();
  const view = render(<BuildReleaseDialog {...p} />);
  fireEvent.change(screen.getByLabelText('Environment for the gates'), { target: { value: 'TEST_PORT=45432' } });
  mocks.snapshot = { role: 'operator' };
  view.rerender(<BuildReleaseDialog {...p} />);
  expect(screen.getByLabelText('Environment for the gates').hasAttribute('disabled')).toBe(true);
  expect(submit().hasAttribute('disabled')).toBe(true);
  fireEvent.click(submit());
  expect(mocks.build).not.toHaveBeenCalled();
  view.rerender(<BuildReleaseDialog {...p} open={false} />);
  view.rerender(<BuildReleaseDialog {...p} />);
  fireEvent.click(submit());
  await waitFor(() => expect(mocks.build).toHaveBeenCalledWith({ project: 'sample' }));
});

it.each(['operator', null])('refuses a prepared override when administrator access is lost (%s)', (role) => {
  const p = props();
  const view = render(<BuildReleaseDialog {...p} />);
  sourceOptions();
  fireEvent.change(screen.getByLabelText('SDK repository'), { target: { value: '/srv/mirrors/omni.git' } });
  mocks.snapshot = role ? { role } : null;
  view.rerender(<BuildReleaseDialog {...p} />);
  expect(screen.getByLabelText('SDK repository').hasAttribute('disabled')).toBe(true);
  expect(submit().hasAttribute('disabled')).toBe(true);
  // A DOM-state bypass must still meet the event handler's current authority.
  submit().removeAttribute('disabled');
  fireEvent.click(submit());
  expect(mocks.build).not.toHaveBeenCalled();
});
