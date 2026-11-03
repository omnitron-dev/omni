// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const { update } = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('src/netron/client', () => ({ pipelines: { updatePipeline: update }, nodes: { listNodes: async () => [] } }));
import { PipelineEditor } from '../../webapp/src/components/pipeline-editor.js';

const definition = {
  id: 'pipeline', name: 'inspect', description: '', revision: 'a'.repeat(64), conditionalUpdates: true as const,
  steps: [{ name: 'one', run: 'echo ready' }], triggers: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe('pipeline edit review', () => {
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
