// @vitest-environment happy-dom

/**
 * A partial start the audit page read like any other.
 *
 * Since 6f37ba6f a stack start in which some apps did not come up is recorded
 * as `outcome: partial`, with `notUp` naming them — a boot on 2026-09-23 had
 * started daos/dev with paysys and messaging errored and recorded `ok`. The
 * console's audit page read no outcome at all: it printed
 * `outcome=partial · notUp=…` among the other particulars, in the same grey,
 * and a failure's error the same way, so a start that half-happened, one that
 * failed and one that worked looked alike. `omnitron audit` colours the three.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

import { outcomeReason } from '../../src/shared/audit-outcome.js';

const at = new Date(Date.now() - 60_000).toISOString();
const row = (id: string, action: string, resourceId: string, details: Record<string, unknown> | null) => ({
  id,
  action,
  actorId: 'omnitron-local',
  actorType: 'user',
  resourceType: action.startsWith('node.') ? 'node' : 'stack',
  resourceId,
  details,
  ipAddress: null,
  createdAt: at,
});

const rows = [
  row('1', 'stack.start', 'daos/dev', {
    type: 'local',
    apps: 6,
    notUp: 'paysys (errored), messaging (errored)',
    source: 'boot',
    outcome: 'partial',
  }),
  row('2', 'stack.start.failed', 'daos/staging', {
    source: 'operator',
    outcome: 'failed',
    error: 'Port 5432 is already in use',
  }),
  // The older convention: the failure named in the action, its words in `message`.
  row('3', 'node.upgrade.failed', 'test-node', { message: 'tarball checksum mismatch' }),
  row('4', 'stack.start', 'daos/test', { type: 'remote', apps: 6, source: 'operator', outcome: 'ok' }),
  row('5', 'stack.stop', 'daos/prod', null),
  // An ending this console does not know is shown as recorded, not dropped.
  row('6', 'stack.start', 'daos/next', { source: 'operator', outcome: 'skipped' }),
];

vi.mock('src/netron/client', () => ({
  audit: { available: vi.fn(async () => ({ available: true })), list: vi.fn(async () => rows) },
}));

async function renderPage() {
  const { default: AuditPage } = await import('../../webapp/src/pages/audit.js');
  render(
    <ThemeProvider theme={createTheme()}>
      <MemoryRouter>
        <AuditPage />
      </MemoryRouter>
    </ThemeProvider>
  );
  await screen.findByText('stack:daos/dev');
  return (resource: string) => within(screen.getByText(resource).closest('tr')!);
}

describe('a partial start the audit page read like any other', () => {
  it('says a start half-happened, and which apps did not come up', async () => {
    const event = await renderPage();
    const dev = event('stack:daos/dev');

    expect(dev.getByText('partial').closest('.MuiChip-root')).toHaveClass('MuiChip-colorWarning');
    expect(dev.getByText('not up: paysys (errored), messaging (errored)')).toBeInTheDocument();
    expect(dev.getByText('type=local · apps=6 · source=boot')).toBeInTheDocument();
    expect(dev.queryByText(/outcome=|notUp=/)).not.toBeInTheDocument();
  });

  it('says a start failed, and why — in either convention a failure was recorded in', async () => {
    const event = await renderPage();

    const staging = event('stack:daos/staging');
    expect(staging.getByText('failed').closest('.MuiChip-root')).toHaveClass('MuiChip-colorError');
    expect(staging.getByText('Port 5432 is already in use')).toBeInTheDocument();
    expect(staging.queryByText(/error=/)).not.toBeInTheDocument();

    const node = event('node:test-node');
    expect(node.getByText('failed').closest('.MuiChip-root')).toHaveClass('MuiChip-colorError');
    expect(node.getByText('tarball checksum mismatch')).toBeInTheDocument();
    expect(node.queryByText(/message=/)).not.toBeInTheDocument();
  });

  it('says a start worked, and claims nothing for a row that records no ending', async () => {
    const event = await renderPage();

    const test = event('stack:daos/test');
    expect(test.getByText('ok').closest('.MuiChip-root')).toHaveClass('MuiChip-colorSuccess');
    expect(test.getByText('type=remote · apps=6 · source=operator')).toBeInTheDocument();

    expect(event('stack:daos/prod').queryByText(/^(ok|partial|failed)$/)).not.toBeInTheDocument();
    expect(event('stack:daos/next').getByText('source=operator · outcome=skipped')).toBeInTheDocument();
  });
});

describe('why a row ended the way it did', () => {
  const reasonOf = (action: string, details: Record<string, unknown>) => outcomeReason({ action, details });

  it('reads what did not come up, and what went wrong, with the key it read', () => {
    expect(reasonOf('stack.start', { outcome: 'partial', notUp: 'paysys (errored)' })).toEqual({
      key: 'notUp',
      text: 'not up: paysys (errored)',
    });
    expect(reasonOf('stack.start.failed', { outcome: 'failed', error: 'boom', message: 'older' })).toEqual({
      key: 'error',
      text: 'boom',
    });
    expect(reasonOf('node.upgrade.failed', { message: 'older' })).toEqual({ key: 'message', text: 'older' });
  });

  it('says nothing the row does not', () => {
    expect(reasonOf('stack.start', { outcome: 'ok', error: 'stale' })).toBeNull();
    expect(reasonOf('stack.start', { outcome: 'partial' })).toBeNull();
    expect(reasonOf('stack.start', { outcome: 'partial', notUp: ['paysys'] })).toBeNull();
    expect(reasonOf('stack.start.failed', { outcome: 'failed', error: '' })).toBeNull();
    expect(reasonOf('secret.set', { key: 'db' })).toBeNull();
  });
});
