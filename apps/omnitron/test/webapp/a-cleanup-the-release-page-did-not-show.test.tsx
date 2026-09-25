// @vitest-environment happy-dom
/**
 * A cleanup the release page did not show.
 *
 * An attestation now keeps what its run took away after itself and what it
 * left (`cleanup`, 48e693c7) — on test on 2026-09-25: 20 accounts, 3
 * organisations, 52 sessions removed, and an organisation and a PaySys
 * account left behind with deposit addresses on a real chain. The release
 * page showed the tally and the failing probes and nothing of that.
 */
import { describe, it, expect, vi } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import '@testing-library/jest-dom/vitest';

vi.mock('src/netron/client', () => ({ daemonClient: { service: vi.fn() } }));
vi.mock('src/stores/project.store', () => ({
  useProjectStore: (select: (s: unknown) => unknown) => select({ stacksByProject: {}, fetchStacks: () => undefined }),
}));

const base = {
  stack: 'test',
  release: 'daos-202609250051-6cb85fdd-6308d07e',
  gates: [
    { name: 'revocation-live', status: 'passed' as const },
    { name: 'dead-tables:main', status: 'failed' as const, detail: '1 table nobody accounted for' },
  ],
  at: '2026-09-25T01:50:00.000Z',
  onNode: { claimed: true, hosts: ['37.27.130.185'], matched: true },
  storedAt: '2026-09-25T01:50:05.000Z',
};

const render = async (attestation: Record<string, unknown>) => {
  const { ReleaseAttestations } = await import('../../webapp/src/components/release-attestations.js');
  rtlRender(
    <ThemeProvider theme={createTheme()}>
      <ReleaseAttestations releaseId={base.release} project="daos" attestations={[attestation as never]} onChanged={() => undefined} />
    </ThemeProvider>,
  );
};

describe('a cleanup the release page did not show', () => {
  it('says what the run removed and each thing it left, with the reason', async () => {
    await render({
      ...base,
      cleanup: {
        run: 'attest-20260925T014726.228Z-f62089',
        removed: { accounts: 20, organisations: 3, paysysAccounts: 0, sessions: 52 },
        leftBehind: [
          { what: 'organisation Ночной Рынок', why: ['PaySys account: 2 deposit address(es) on a real chain'] },
        ],
      },
    });
    const note = screen.getByTestId('cleanup-test');
    expect(note).toHaveTextContent('cleanup: run attest-20260925T014726.228Z-f62089 removed 20 accounts, 3 organisations, 52 sessions');
    expect(note).toHaveTextContent('left behind: organisation Ночной Рынок — PaySys account: 2 deposit address(es) on a real chain');
  });

  it('shows what the run retired apart from what it removed', async () => {
    await render({
      ...base,
      cleanup: { run: 'r5', removed: { accounts: 478, organisations: 97 }, retired: { paysysAccounts: 107 } },
    });
    const note = screen.getByTestId('cleanup-test');
    expect(note).toHaveTextContent('cleanup: run r5 removed 478 accounts, 97 organisations');
    expect(note).toHaveTextContent('retired: 107 paysysAccounts — blocked in place, their real-chain addresses still watched');
  });

  it('says so when the removal was not run, and when the legal texts could not be read', async () => {
    await render({ ...base, cleanup: { run: null, notRun: 'the producer ran without a run name' }, legalTextsUnread: 'the gateway did not answer' });
    const note = screen.getByTestId('cleanup-test');
    expect(note).toHaveTextContent('cleanup not run — the producer ran without a run name');
    expect(note).toHaveTextContent('legal texts could not be read — the gateway did not answer');
  });

  it('adds nothing to a record stored before it was kept', async () => {
    await render(base);
    expect(screen.queryByTestId('cleanup-test')).toBeNull();
  });
});
