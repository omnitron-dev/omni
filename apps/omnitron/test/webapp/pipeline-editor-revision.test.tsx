// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const { update } = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('src/netron/client', () => ({ pipelines: { updatePipeline: update }, nodes: { listNodes: async () => [] } }));
import { PipelineEditor } from '../../webapp/src/components/pipeline-editor.js';
import type { PipelineStep } from '../../src/shared/dto/pipelines.js';

const definition = {
  id: 'pipeline', name: 'inspect', description: '', revision: 'a'.repeat(64), conditionalUpdates: true as const,
  steps: [{ name: 'one', run: 'echo ready' }], triggers: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe('pipeline edit review', () => {
  it('preserves a release target and literal arguments through the editor and JSON round trip', async () => {
    const step: PipelineStep = { name: 'publish', kind: 'release', target: {
      project: 'research', stack: 'publication', app: 'publisher', entry: 'dist/publish.mjs',
      artifact: { releaseId: 'publication-1', manifestSha256: 'a'.repeat(64), artifactSha256: 'b'.repeat(64),
        producerApp: 'publisher', projectCommit: 'c'.repeat(40), frameworkCommit: 'd'.repeat(40) },
    }, args: ['literal;$(no-shell)', 'two words'], cwd: '/operator', env: { OPERATOR_ROOT: '/operator' } };
    render(<PipelineEditor definition={{ ...definition, steps: [step] }} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByLabelText('Pinned release target')).toHaveAttribute('readonly');
    fireEvent.click(screen.getByRole('button', { name: 'Advanced JSON' }));
    fireEvent.click(screen.getByRole('button', { name: 'Step editor' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'renamed' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({
      definition: expect.objectContaining({ name: 'renamed', steps: [step] }),
    })));
  });
  it('preserves loaded trigger declarations when editing the name or steps', async () => {
    const triggers = [{ type: 'manual' as const, config: { label: 'Operator review' } }];
    update.mockResolvedValue({ ...definition, triggers });
    render(<PipelineEditor definition={{ ...definition, triggers }} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'renamed' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({
      id: definition.id, expectedRevision: definition.revision,
      definition: { name: 'renamed', description: '', steps: definition.steps, triggers },
    }));
  });
  it('sends the original revision and preserves the draft when a concurrent edit wins', async () => {
    update.mockRejectedValue(Error('Pipeline changed after review. Reload and review the current definition'));
    const close = vi.fn(), saved = vi.fn();
    render(<PipelineEditor definition={definition} onClose={close} onSaved={saved} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'my draft' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({
      id: definition.id, expectedRevision: definition.revision, definition: expect.objectContaining({ name: 'my draft' }),
    })));
    expect(await screen.findByText(/Pipeline changed after review/)).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('my draft');
    expect(close).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();
  });
  it('does not send a conditional edit to a daemon that would ignore its revision', async () => {
    render(<PipelineEditor definition={{ ...definition, conditionalUpdates: undefined }} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    expect(await screen.findByText(/Update the daemon/)).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });
});
