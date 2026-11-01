// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
const rpc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('src/netron/client', () => ({ daemonClient: { invoke: rpc.invoke } }));
vi.mock('src/auth/access', () => ({ Can: () => null }));
import { StackDiagnosisDialog } from '../../webapp/src/components/stack-diagnosis-dialog.js';
afterEach(() => { cleanup(); rpc.invoke.mockReset(); });
const report = { project: 'sample', stack: 'dev', status: 'changes', checkedAt: new Date().toISOString(), durationMs: 40,
  checks: [{ code: 'docker.available', resource: 'Docker', state: 'pass', message: 'Docker answered' }, { code: 'container.create', resource: 'Postgres', state: 'change', message: 'Will create PostgreSQL' }], deferred: ['Migrations'] };
const mount = () => render(<ThemeProvider theme={createTheme()}><StackDiagnosisDialog project="sample" stack="dev" onClose={() => undefined} /></ThemeProvider>);
describe('stack readiness dialog', () => {
  it('explains a pending check, shows findings and filters verified rows without starting anything', async () => {
    let finish!: (value: unknown) => void; rpc.invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    mount(); expect(screen.getByText('Checking stack prerequisites')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Check again' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { finish(report); });
    expect(screen.getByText('Changes required at start')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Needs attention' }));
    expect(screen.queryByText('Docker answered')).toBeNull(); expect(screen.getByText('Will create PostgreSQL')).toBeTruthy();
    expect(rpc.invoke).toHaveBeenCalledTimes(1); expect(rpc.invoke.mock.calls[0]?.[2]).toBe('diagnoseStack');
  });
  it('keeps previous findings visibly stale after a failed retry', async () => {
    rpc.invoke.mockResolvedValueOnce(report).mockRejectedValue(new Error('Daemon unavailable'));
    mount(); await waitFor(() => expect(screen.getByText('Will create PostgreSQL')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(screen.getByText(/previous report is retained below and is stale/)).toBeTruthy());
    expect(screen.getByText('Will create PostgreSQL')).toBeTruthy();
  });
});
