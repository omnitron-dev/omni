// @vitest-environment happy-dom

/**
 * The telemetry row disappeared rather than saying it could not be read.
 *
 * Three blocks on the node dialog report a read of a remote node, and two of
 * them handle a refusal the same way — a «not asked» chip and the reason in
 * monospace:
 *
 *     NodeIndicators    if (!data.reachable) → chip + data.error
 *     NodeSyncStatus    if (!data.reachable || !data.sync) → chip + data.error
 *     NodeRelay         if (!data.reachable || !data.relay) → return null
 *
 * So a node whose telemetry could not be read looked exactly like a node
 * whose telemetry was fine: the row was simply absent. `INodeRelayStats`
 * carries `error` for this, and it was being thrown away.
 *
 * It was not a corner case. Until `OmnitronTelemetry.getRelayStats` moved to
 * `CONTROL_PLANE_READ_ROLES` earlier today (2c951e4c), every node refused
 * that read with «Missing required role» — so the empty space WAS the
 * permanent state of this panel, for every node, and nothing anywhere said
 * why. The same authorization defect hid behind a blank «Sync» column, which
 * is what led here.
 *
 * `totalDropped` is what this panel exists for: «the one counter in the fleet
 * that reports LOSS», per its own docblock. A panel that silently vanishes is
 * the worst possible way to not report loss.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import '@testing-library/jest-dom/vitest';

import { NodeRelay } from '../../webapp/src/pages/nodes.js';

const theme = createTheme();
const draw = (ui: React.ReactNode) => render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

const relay = (over: Record<string, unknown> = {}) => ({
  nodeId: 'n1',
  reachable: true,
  error: null,
  relay: {
    buffer: { size: 3, totalPushed: 100, totalDropped: 0, totalFlushed: 97 },
    totalSent: 97,
    totalFailed: 0,
    transportConnected: true,
    ...over,
  },
});

describe('a panel that vanished instead of explaining', () => {
  // `screen` queries the whole document, so a second render inside one test
  // sees the first one's output too. Caught by the DROPPED case below, which
  // draws twice on purpose.
  afterEach(cleanup);

  it('says why when the node refused the read', () => {
    draw(
      <NodeRelay
        data={{ nodeId: 'n1', reachable: false, error: 'Missing required role', relay: null } as never}
      />,
    );

    expect(screen.getByText('not asked'), 'the state is named').toBeInTheDocument();
    expect(screen.getByText('Missing required role'), 'and so is the reason').toBeInTheDocument();
  });

  it('says so even when the node gave no reason', () => {
    draw(<NodeRelay data={{ nodeId: 'n1', reachable: false, error: null, relay: null } as never} />);

    expect(screen.getByText('not asked')).toBeInTheDocument();
    expect(screen.getByText('no reason given')).toBeInTheDocument();
  });

  it('still shows the figures when the node answered', () => {
    // Control: the refusal branch must not swallow the working one.
    draw(<NodeRelay data={relay() as never} />);

    expect(screen.getByText('transport up')).toBeInTheDocument();
    expect(screen.getByText(/3 buffered/)).toBeInTheDocument();
  });

  it('shouts about dropped entries, and only when there are any', () => {
    // The reason this panel exists. Loud on loss, quiet otherwise — a chip
    // that is always present stops being read.
    draw(<NodeRelay data={relay({ buffer: { size: 0, totalDropped: 41 } }) as never} />);
    expect(screen.getByText('41 DROPPED')).toBeInTheDocument();

    cleanup();
    draw(<NodeRelay data={relay() as never} />);
    expect(screen.queryByText(/DROPPED/), 'silent when nothing was lost').not.toBeInTheDocument();
  });

  it('draws nothing at all before the dialog has asked', () => {
    // Control: «not read yet» is not «could not be read», and must stay
    // silent rather than claim a refusal that never happened.
    const { container } = draw(<NodeRelay data={null} />);

    expect(container).toBeEmptyDOMElement();
  });
});
