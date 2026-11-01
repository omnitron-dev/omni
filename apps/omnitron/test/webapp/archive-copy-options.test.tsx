// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ArchiveCopyOptions } from '../../webapp/src/components/files/archive-copy-options';
import { FileTransferProgress, fileTransferProgress } from '../../webapp/src/components/files/transfer-progress';
import type { FileArchiveCapabilities, FileTransfer } from '../../src/shared/dto/files';
const mocks = vi.hoisted(() => ({ capabilities: vi.fn() }));
vi.mock('src/netron/client', () => ({ files: { archiveFormats: mocks.capabilities } }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const capabilities: FileArchiveCapabilities = {
  observedAt: '2026-11-02T00:00:00Z',
  limitations: ['Bounded snapshots; existing destinations are not replaced.'],
  formats: [
    { format: 'tar.gz', label: 'Gzip TAR', extension: '.tar.gz', outputs: ['archive', 'directory'] },
    { format: 'zip', label: 'ZIP', extension: '.zip', outputs: ['archive'] },
  ],
};

it('probes only on demand and offers formats compatible with the explicit output mode', async () => {
  let resolve!: (value: FileArchiveCapabilities) => void;
  mocks.capabilities.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const changed = vi.fn();
  render(
    <ArchiveCopyOptions sourceNodeId="source" destinationNodeId="target" directoryName="project" onChange={changed} />
  );
  expect(mocks.capabilities).not.toHaveBeenCalled();
  expect(changed).toHaveBeenLastCalledWith({ archive: undefined, ready: true });
  fireEvent.click(screen.getByRole('button', { name: 'Save archive file' }));
  expect(changed).toHaveBeenLastCalledWith({ archive: undefined, ready: false });
  expect(screen.getByRole('status')).toBeTruthy();
  expect(mocks.capabilities).toHaveBeenCalledWith({ nodeId: 'source', destinationNodeId: 'target' });
  resolve(capabilities);
  await waitFor(() =>
    expect(changed).toHaveBeenLastCalledWith({
      archive: { format: 'tar.gz', name: 'project.tar.gz', output: 'archive' },
      ready: true,
    })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Transfer archive and restore folder' }));
  await waitFor(() =>
    expect(changed).toHaveBeenLastCalledWith({
      archive: { format: 'tar.gz', name: 'project', output: 'directory' },
      ready: true,
    })
  );
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Archive format' }));
  expect(screen.getByRole('option', { name: 'Gzip TAR' })).toBeTruthy();
  expect(screen.queryByRole('option', { name: 'ZIP' })).toBeNull();
  fireEvent.click(screen.getByRole('option', { name: 'Gzip TAR' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Destination folder name' }), {
    target: { value: '../escape' },
  });
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith({ archive: undefined, ready: false }));
  expect(mocks.capabilities).toHaveBeenCalledTimes(1);
});

it('does not use late capability answers for another node pair and keeps ordinary copy available on failure', async () => {
  let old!: (value: FileArchiveCapabilities) => void;
  mocks.capabilities
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          old = done;
        })
    )
    .mockRejectedValueOnce(new Error('offline'));
  const changed = vi.fn();
  const component = (sourceNodeId: string) => (
    <ArchiveCopyOptions
      sourceNodeId={sourceNodeId}
      destinationNodeId="target"
      directoryName="project"
      onChange={changed}
    />
  );
  const mounted = render(component('source'));
  fireEvent.click(screen.getByRole('button', { name: 'Save archive file' }));
  mounted.rerender(component('replacement'));
  old(capabilities);
  await waitFor(() => expect(screen.getByText(/Archive capabilities are unavailable/)).toBeTruthy());
  expect(screen.queryByRole('combobox', { name: 'Archive format' })).toBeNull();
  expect(changed).toHaveBeenLastCalledWith({ archive: undefined, ready: false });
  fireEvent.click(screen.getByRole('button', { name: 'Copy files individually' }));
  expect(changed).toHaveBeenLastCalledWith({ archive: undefined, ready: true });
});

it('requires the selected archive extension and never treats transferred bytes as completed restoration', async () => {
  mocks.capabilities.mockResolvedValue(capabilities);
  const changed = vi.fn();
  const mounted = render(
    <ArchiveCopyOptions sourceNodeId="source" destinationNodeId="target" directoryName="project" onChange={changed} />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save archive file' }));
  const name = await screen.findByRole('textbox', { name: 'Archive filename' });
  fireEvent.change(name, { target: { value: 'wrong.zip' } });
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith({ archive: undefined, ready: false }));
  expect(screen.getByText('Use a filename ending in .tar.gz')).toBeTruthy();
  mounted.unmount();
  const job = {
    state: 'running',
    phase: 'restoring',
    archive: { format: 'tar.gz', name: 'project', output: 'directory' },
    bytes: 1024,
    totalBytes: 1024,
    completedFiles: 0,
    totalFiles: 1,
  } as FileTransfer;
  render(<FileTransferProgress job={job} />);
  expect(screen.getByRole('progressbar', { name: 'Restoring destination folder' }).hasAttribute('aria-valuenow')).toBe(
    false
  );
  expect(screen.queryByText(/^Completed/)).toBeNull();
  expect(fileTransferProgress({ ...job, phase: 'snapshotting', preparedBytes: 512, sourceBytes: 1024 })).toMatchObject({
    value: 50,
    indeterminate: false,
  });
  expect(fileTransferProgress({ ...job, state: 'paused' }).indeterminate).toBe(false);
  expect(fileTransferProgress({ ...job, state: 'completed' })).toMatchObject({ value: 100, indeterminate: false });
});
