// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { TopologyMetadataDialog } from '../../webapp/src/components/topology/topology-metadata-dialog.js';
const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('src/netron/client', () => ({ daemonClient: api }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('keeps partial discovery failures visible and reloads evidence without reporting success', async () => {
  const onClose = vi.fn(), onUpdated = vi.fn(async () => {});
  api.invoke.mockResolvedValue({ refreshed: 1, failures: [{ project: 'sample', app: 'worker', reason: 'Declarations unavailable' }] });
  render(<ThemeProvider theme={createTheme()}><TopologyMetadataDialog project="sample" stack="prod" onClose={onClose} onUpdated={onUpdated} /></ThemeProvider>);
  expect(api.invoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Update declarations' }));
  await screen.findByText('worker: Declarations unavailable');
  expect(api.invoke).toHaveBeenCalledWith('daemon', 'OmnitronProject', 'refreshTopologyMetadata', [{ project: 'sample', stack: 'prod' }], { timeout: 120_000 });
  expect(onUpdated).toHaveBeenCalledOnce();
  expect(onClose).not.toHaveBeenCalled();
});
it('updates all stacks of a project and closes only after fresh observations have loaded', async () => {
  const onClose = vi.fn(), onUpdated = vi.fn(async () => {});
  api.invoke.mockResolvedValue({ refreshed: 2, failures: [] });
  render(<ThemeProvider theme={createTheme()}><TopologyMetadataDialog project="sample" stack={null} onClose={onClose} onUpdated={onUpdated} /></ThemeProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Update declarations' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(api.invoke).toHaveBeenCalledWith('daemon', 'OmnitronProject', 'refreshTopologyMetadata', [{ project: 'sample' }], { timeout: 120_000 });
  expect(onUpdated).toHaveBeenCalledOnce();
});
