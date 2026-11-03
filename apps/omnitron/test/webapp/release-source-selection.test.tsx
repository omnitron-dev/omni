// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReleasePreflightView } from '../../webapp/src/netron/release-wire';

const mocks = vi.hoisted(() => ({ build: vi.fn(), fetchStacks: vi.fn() }));
vi.mock('src/netron/client', () => ({ releases: { build: mocks.build } }));
vi.mock('src/stores/project.store', () => {
  const state = { projects: [{ name: 'sample' }], stacksByProject: { sample: [] }, fetchStacks: mocks.fetchStacks };
  return { useProjectStore: (select: (value: typeof state) => unknown) => select(state) };
});
const { default: BuildReleaseDialog } = await import('../../webapp/src/pages/releases/build-release-dialog');
const preflight: ReleasePreflightView = { root: '/private/releases', canBuild: true, missingTools: [], path: [], load: [0, 0, 0], cpus: 2, frameworkSource: 1 };
const props = () => ({ open: true, onClose: vi.fn(), onStarted: vi.fn(), defaultProject: 'sample', preflight });
beforeEach(() => { mocks.build.mockResolvedValue({ buildId: 'private-build' }); });
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
