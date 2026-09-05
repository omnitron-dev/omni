/**
 * DurationPicker — presets, and the custom row.
 *
 * The component is controlled: the parent owns the value and echoes it back.
 * Every test below drives it through a real stateful parent, because the
 * defect it was written for only exists once the value comes back — a test
 * that passed a fixed `value` would never have created the condition.
 */

import { useState } from 'react';

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DurationPicker } from './duration-picker.js';

/** A parent that owns the value, as every real caller does. */
function Controlled({ initial = null, onChange }: { initial?: number | null; onChange?: (s: number | null) => void }) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <>
      <DurationPicker
        value={value}
        onChange={(s) => {
          setValue(s);
          onChange?.(s);
        }}
      />
      <output data-testid="value">{value === null ? 'permanent' : String(value)}</output>
    </>
  );
}

const HOUR = 3600;
const DAY = 86400;

describe('DurationPicker presets', () => {
  it('emits the seconds behind a preset', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: '6h' }));

    expect(onChange).toHaveBeenCalledWith(6 * HOUR);
    expect(screen.getByTestId('value')).toHaveTextContent(String(6 * HOUR));
  });

  it('emits null for permanent', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={HOUR} />);

    await user.click(screen.getByRole('button', { name: '∞' }));

    expect(screen.getByTestId('value')).toHaveTextContent('permanent');
  });

  it('marks the preset that matches the incoming value', () => {
    render(<Controlled initial={7 * DAY} />);

    expect(screen.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('DurationPicker custom mode', () => {
  it('opens the custom row even though its default value IS a preset', async () => {
    // The defect: clicking Custom emitted 1 hour, 1 hour is the `1h` preset,
    // and the mode was derived from the value — so the next render put the
    // selection back on `1h` and the row never appeared. In the default
    // state the button did nothing at all.
    const user = userEvent.setup();
    render(<Controlled />);

    await user.click(screen.getByRole('button', { name: 'Custom' }));

    expect(screen.getByRole('spinbutton')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Custom' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '1h' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('stays in custom mode when the typed amount collides with a preset', async () => {
    const user = userEvent.setup();
    render(<Controlled />);

    await user.click(screen.getByRole('button', { name: 'Custom' }));
    const amount = screen.getByRole('spinbutton');
    await user.clear(amount);
    await user.type(amount, '24');

    // 24 hours is exactly the `1d` preset. The row must survive it.
    expect(screen.getByTestId('value')).toHaveTextContent(String(DAY));
    expect(screen.getByRole('spinbutton')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1d' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('converts the unit against the current amount', async () => {
    const user = userEvent.setup();
    render(<Controlled />);

    await user.click(screen.getByRole('button', { name: 'Custom' }));
    await user.clear(screen.getByRole('spinbutton'));
    await user.type(screen.getByRole('spinbutton'), '3');
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'days' }));

    expect(screen.getByTestId('value')).toHaveTextContent(String(3 * DAY));
  });

  it('leaves custom mode when a preset is clicked', async () => {
    const user = userEvent.setup();
    render(<Controlled />);

    await user.click(screen.getByRole('button', { name: 'Custom' }));
    expect(screen.getByRole('spinbutton')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '6h' }));

    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '6h' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens in custom mode for a value no preset matches', () => {
    // 3 hours is nobody's preset, so it is custom whoever set it — including
    // a parent restoring a saved form.
    render(<Controlled initial={3 * HOUR} />);

    expect(screen.getByRole('spinbutton')).toHaveValue(3);
    expect(screen.getByRole('button', { name: 'Custom' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('lets the field be empty without emitting, and restores it on blur', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={3 * HOUR} />);

    const amount = screen.getByRole('spinbutton');
    await user.clear(amount);

    // An empty field is not a duration. It must be possible to hold — you
    // cannot retype an amount otherwise — and it must not emit: a moderation
    // action would receive NaN seconds, or silently 1 hour.
    expect(amount).toHaveValue(null);
    expect(screen.getByTestId('value')).toHaveTextContent(String(3 * HOUR));

    await user.tab();
    expect(screen.getByRole('spinbutton')).toHaveValue(3);
  });

  it('accepts a retyped amount instead of appending to the old one', async () => {
    // With the field forced back to "1" on every empty parse, typing "3"
    // gave 13 and typing "24" gave 124 — the previous digits stayed in
    // front. Replacing a value is the ordinary way to use the field.
    const user = userEvent.setup();
    render(<Controlled initial={3 * HOUR} />);

    const amount = screen.getByRole('spinbutton');
    await user.clear(amount);
    await user.type(amount, '5');

    expect(amount).toHaveValue(5);
    expect(screen.getByTestId('value')).toHaveTextContent(String(5 * HOUR));
  });
});
