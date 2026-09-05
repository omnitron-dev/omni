/**
 * DateRangeInput — the field, its label, and the dialog behind it.
 *
 * The field is read-only and shows a formatted range; everything an
 * operator can do to it goes through the dialog or the clear button. Both
 * are pinned here, along with the label's four shapes, because the label is
 * the only place the selected range is visible once the dialog closes.
 */

import { useState } from 'react';

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import { DateRangeInput } from './date-range-input.js';

// The dialog reads breakpoints through `useMediaQuery`, so a theme is not
// optional here — the same one every consumer gets from `PrismProvider`.
const theme = createTheme();

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <LocalizationProvider dateAdapter={AdapterDayjs}>{children}</LocalizationProvider>
    </ThemeProvider>
  );
}

function Controlled({
  start = '',
  end = '',
  onChange,
}: {
  start?: string;
  end?: string;
  onChange?: (s: string, e: string) => void;
}) {
  const [range, setRange] = useState({ start, end });
  return (
    <Wrapper>
      <DateRangeInput
        startDate={range.start}
        endDate={range.end}
        onChange={(s, e) => {
          setRange({ start: s, end: e });
          onChange?.(s, e);
        }}
      />
    </Wrapper>
  );
}

const field = () => screen.getByRole('textbox');

/**
 * Type into one of the dialog's date fields.
 *
 * MUI v9 renders a section list rather than a text input, so the field is
 * addressed as a group and filled from the keyboard, one section at a time.
 */
async function type(label: string, digits: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('group', { name: label }));
  await user.keyboard(digits);
}

describe('DateRangeInput label', () => {
  it('shows the placeholder while both ends are empty', () => {
    render(<Controlled />);
    expect(field()).toHaveValue('');
    expect(field()).toHaveAttribute('placeholder', 'Select dates...');
  });

  it('collapses a same-day range to one date', () => {
    render(<Controlled start="2026-01-12" end="2026-01-12" />);
    expect(field()).toHaveValue('12 Jan 2026');
  });

  it('writes the month once when both ends share it', () => {
    render(<Controlled start="2026-01-12" end="2026-01-31" />);
    expect(field()).toHaveValue('12 – 31 Jan 2026');
  });

  it('writes the year once when both ends share it', () => {
    render(<Controlled start="2026-01-12" end="2026-03-04" />);
    expect(field()).toHaveValue('12 Jan – 04 Mar 2026');
  });

  it('writes both years when they differ', () => {
    render(<Controlled start="2025-12-30" end="2026-01-02" />);
    expect(field()).toHaveValue('30 Dec 2025 – 02 Jan 2026');
  });

  it('prefixes a half-open range', () => {
    const { unmount } = render(<Controlled start="2026-01-12" />);
    expect(field()).toHaveValue('From 12 Jan 2026');
    unmount();

    render(<Controlled end="2026-01-12" />);
    expect(field()).toHaveValue('To 12 Jan 2026');
  });
});

describe('DateRangeInput clear', () => {
  it('offers the clear button only when there is a range', () => {
    const { unmount } = render(<Controlled />);
    expect(screen.queryByRole('button', { name: /clear date range/i })).not.toBeInTheDocument();
    unmount();

    render(<Controlled start="2026-01-12" end="2026-01-31" />);
    expect(screen.getByRole('button', { name: /clear date range/i })).toBeInTheDocument();
  });

  it('clears both ends without opening the dialog', async () => {
    // The button sits inside a field whose own click opens the dialog, so
    // the handler has to stop the event. If it stops being stopped, the
    // dialog appears over a field the operator meant to empty.
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled start="2026-01-12" end="2026-01-31" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /clear date range/i }));

    expect(onChange).toHaveBeenCalledWith('', '');
    expect(field()).toHaveValue('');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('DateRangeInput dialog', () => {
  it('opens on click', async () => {
    const user = userEvent.setup();
    render(<Controlled start="2026-01-12" end="2026-01-31" />);

    await user.click(field());

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Select date range')).toBeInTheDocument();
  });

  it('leaves the range untouched on Cancel', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled start="2026-01-12" end="2026-01-31" onChange={onChange} />);

    await user.click(field());
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onChange).not.toHaveBeenCalled();
    // The open dialog marks the rest of the document aria-hidden, so the
    // field is only queryable again once the dialog has finished closing.
    expect(await screen.findByRole('textbox')).toHaveValue('12 – 31 Jan 2026');
  });

  it('commits the edited range through Apply, as ISO strings', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled start="2026-01-12" end="2026-01-31" onChange={onChange} />);

    await user.click(field());
    await type('Start date', '01202026');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    // ISO, not the formatted label the field itself displays.
    expect(onChange).toHaveBeenCalledWith('2026-01-20', '2026-01-31');
    expect(await screen.findByRole('textbox')).toHaveValue('20 – 31 Jan 2026');
  });

  it('discards an edit that was cancelled, and reopens from the props', async () => {
    // `handleOpen` re-reads the props on every open. Without that the
    // cancelled edit is still sitting in the dialog the next time it opens,
    // and one more click on Apply commits a change the operator rejected.
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled start="2026-01-12" end="2026-01-31" onChange={onChange} />);

    await user.click(field());
    await type('Start date', '01202026');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await user.click(await screen.findByRole('textbox'));
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('2026-01-12', '2026-01-31');
  });

  it('refuses to apply an inverted range, and says why', async () => {
    const user = userEvent.setup();
    render(<Controlled start="2026-01-12" end="2026-01-31" />);

    await user.click(field());
    await type('Start date', '02202026');

    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    // The message has to describe the rule that is actually enforced: the
    // guard is `isAfter`, so an equal pair is a legitimate one-day range and
    // "must be later than" would send an operator looking for a bug.
    expect(screen.getByText('End date cannot be earlier than start date')).toBeInTheDocument();
  });

  it('accepts an equal pair as a one-day range', async () => {
    const user = userEvent.setup();
    render(<Controlled start="2026-01-12" end="2026-01-31" />);

    await user.click(field());
    await type('End date', '01122026');

    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(await screen.findByRole('textbox')).toHaveValue('12 Jan 2026');
  });
});
