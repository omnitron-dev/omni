// @vitest-environment happy-dom

/**
 * A prune the console could not see.
 *
 * The dialog built the list of releases to keep from `deployments()` and
 * sent it as `protect`. A daemon without its audit trail serves
 * `deployments()` as `[]`, so the list was empty and the second press would
 * have removed the release a stack runs. The daemon now decides what a stack
 * runs from its own trail and says when it cannot (f19b16b0); the dialog
 * shows that answer, names what is kept, and removes nothing while the
 * daemon cannot tell.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import '@testing-library/jest-dom/vitest';

const prune = vi.fn();

vi.mock('src/netron/client', () => ({
  releases: { prune: (...a: unknown[]) => prune(...a) },
}));

const answer = (over: Record<string, unknown>) => ({
  doomed: [{ id: 'daos-202609221438-6c62b7ae-09d95ed2', bytes: 2_000_000 }],
  removed: [],
  kept: 3,
  freedBytes: 2_000_000,
  spared: [],
  protectedByDeployment: [],
  unknown: null,
  ...over,
});

const render = async () => {
  const { default: PruneReleasesDialog } = await import('../../webapp/src/pages/releases/prune-releases-dialog.js');
  rtlRender(
    <ThemeProvider theme={createTheme()}>
      <PruneReleasesDialog open onClose={() => undefined} onPruned={() => undefined} />
    </ThemeProvider>,
  );
};

beforeEach(() => {
  prune.mockReset();
});

describe('a prune the console could not see', () => {
  it('says why when the daemon cannot tell what a stack runs, and removes nothing', async () => {
    prune.mockResolvedValue(answer({ unknown: 'the daemon has no audit trail' }));
    await render();

    expect(await screen.findByText(/the daemon has no audit trail/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove 1/i })).toBeDisabled();
  });

  it('names what is kept because a stack runs it, and asks the daemon without a list of its own', async () => {
    prune.mockResolvedValue(answer({ protectedByDeployment: ['daos-202609230810-66740d9c-5a3315fc'] }));
    await render();

    expect(await screen.findByText(/daos-202609230810-66740d9c-5a3315fc/)).toBeInTheDocument();
    const remove = screen.getByRole('button', { name: /remove 1/i });
    await waitFor(() => expect(remove).toBeEnabled());

    await userEvent.setup().click(remove);
    await waitFor(() => expect(prune).toHaveBeenLastCalledWith({ keep: 5, apply: true }));
    // Never a `protect` of the console's making: that was the empty list.
    for (const [call] of prune.mock.calls) expect(call).not.toHaveProperty('protect');
  });
});
