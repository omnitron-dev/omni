// @vitest-environment happy-dom
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ConsoleKeyboard } from '../../webapp/src/components/console-keyboard';
import FilesPage from '../../webapp/src/pages/files';
const mocks = vi.hoisted(() => ({ rename: vi.fn(async () => ({ path: 'renamed.txt', version: 'new' })) }));
vi.mock('src/netron/client', () => ({ nodes: { listNodes: vi.fn(async () => []) }, files: {
  transfers: vi.fn(async () => []),
  roots: vi.fn(async () => ({ protocol: 1, roots: [{ id: 'work', label: 'Work', readOnly: false }] })),
  list: vi.fn(async () => ({ entries: [{ name: 'example.txt', path: 'example.txt', kind: 'file', size: 4, version: 'old', modifiedAt: '2026-11-02' }], next: null, revision: '1' })),
  rename: mocks.rename,
} }));
beforeAll(() => { Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('keeps compact toolbar actions named and validates a rename before making an RPC request', async () => {
  render(<MemoryRouter><ConsoleKeyboard navigation={[]}><FilesPage /></ConsoleKeyboard></MemoryRouter>);
  const left = await screen.findByRole('table', { name: 'left files' });
  await waitFor(() => expect(within(left).getByRole('row', { name: 'file example.txt' })).toBeTruthy());
  const toolbar = screen.getByRole('toolbar', { name: 'File actions' });
  expect(within(toolbar).getByRole('button', { name: 'Copy A to B' }).textContent).toContain('A → B');
  expect(within(toolbar).getByRole('button', { name: 'New folder' })).toBeTruthy();
  expect(within(toolbar).getByRole('button', { name: 'Upload from this computer' })).toBeTruthy();
  const user = userEvent.setup();
  await user.click(within(left).getByRole('checkbox', { name: 'Select example.txt' }));
  await user.keyboard('{F2}');
  const name = await screen.findByRole('textbox', { name: 'Name' });
  await user.clear(name); await user.type(name, 'nested/name.txt');
  expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.rename).not.toHaveBeenCalled();
  await user.clear(name); await user.type(name, 'renamed.txt');
  await user.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(mocks.rename).toHaveBeenCalledWith({ nodeId: 'local', rootId: 'work', path: 'example.txt', destination: 'renamed.txt', version: 'old' }));
});
