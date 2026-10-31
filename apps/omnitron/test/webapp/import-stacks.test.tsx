// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ImportStacksDialog } from '../../webapp/src/components/import-stacks-dialog';
import type { IProjectInfo } from '../../src/shared/dto/project';

afterEach(cleanup);
const project = { name: 'sample', displayName: 'Sample', path: '/repo', catalogRevision: 'revision' } as IProjectInfo;
function form() {
  const onImport = vi.fn(async () => {}), onClose = vi.fn();
  render(<ImportStacksDialog project={project} onImport={onImport} onClose={onClose} />);
  fireEvent.change(screen.getByLabelText('Configuration name', { exact: false }), { target: { value: 'research' } });
  fireEvent.change(screen.getByLabelText('Configuration directory', { exact: false }), { target: { value: '/repo/research' } });
  return { onImport, onClose };
}
it('submits explicit stack ownership with the observed revision and retained namespace', async () => {
  const { onImport, onClose } = form();
  fireEvent.change(screen.getByLabelText('Existing registration (optional)'), { target: { value: 'sample-research' } });
  fireEvent.change(screen.getByLabelText('Stack mapping'), { target: { value: 'local=research\nproduction=research-prod' } });
  fireEvent.click(screen.getByRole('button', { name: 'Import stacks' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(onImport).toHaveBeenCalledWith({ project: 'sample', name: 'research', path: '/repo/research', registration: 'sample-research',
    stacks: { local: 'research', production: 'research-prod' }, expectedRevision: 'revision' });
});
it('keeps an invalid mapping editable and never submits it', async () => {
  const { onImport, onClose } = form();
  fireEvent.change(screen.getByLabelText('Stack mapping'), { target: { value: 'local=test\nlocal=prod' } });
  fireEvent.click(screen.getByRole('button', { name: 'Import stacks' }));
  expect((await screen.findByRole('alert')).textContent).toContain('unique source=project');
  expect(onImport).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});
