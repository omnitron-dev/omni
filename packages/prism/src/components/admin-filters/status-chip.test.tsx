/**
 * StatusChip — status badge with automatic colour mapping.
 *
 * Used 20 times in the DAOS portal, always with a status string that came
 * from the server. That is the risk this file exists to pin: an unexpected
 * status must degrade to a neutral chip, never take the page down.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { StatusChip } from './status-chip.js';

describe('StatusChip', () => {
  it('capitalises the raw status when no label is given', () => {
    render(<StatusChip status="ACTIVE" />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('prefers an explicit label, keeping status for colour only', () => {
    render(<StatusChip status="active" label="Активен" />);
    expect(screen.getByText('Активен')).toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });

  it('renders an unknown status neutrally instead of failing', () => {
    render(<StatusChip status="quantum-superposition" />);
    expect(screen.getByText('Quantum-superposition')).toBeInTheDocument();
  });

  it('survives a status that collides with an Object.prototype key', () => {
    // The colour map was a plain object literal, so `map['constructor']`
    // returned a FUNCTION — `?? 'default'` accepted it as a colour and
    // `theme.palette[fn].main` threw, taking the React tree down with it.
    // A status string arrives from the server; it must never be able to do
    // that.
    for (const status of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
      const { unmount } = render(<StatusChip status={status} />);
      expect(screen.getByText(new RegExp(status.replace(/[_]/g, '_'), 'i'))).toBeInTheDocument();
      unmount();
    }
  });

  it('lets a caller extend the map without losing the defaults', () => {
    render(
      <>
        <StatusChip status="bespoke" colorMap={{ bespoke: 'info' }} />
        <StatusChip status="active" colorMap={{ bespoke: 'info' }} />
      </>
    );

    expect(screen.getByText('Bespoke')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('is case-insensitive about the status', () => {
    render(<StatusChip status="PeNdInG" />);
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });
});
