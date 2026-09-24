/**
 * A deadline said as how long, in the reader's language, coloured by how
 * little — the chip the downstream home page puts on every item that waits
 * for its reader.
 */
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';

import { createPrismTheme } from '../../theme/create-theme.js';
import { DeadlineChip, deadlineUrgency, relativeTimeLeft } from './deadline-chip.js';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-09-24T12:00:00Z');
const clock = () => NOW;

function themed(node: ReactElement) {
  return render(<ThemeProvider theme={createPrismTheme()}>{node}</ThemeProvider>);
}

describe('deadlineUrgency', () => {
  it('is overdue at and past the moment, urgent within an hour, soon within a day, later beyond', () => {
    expect(deadlineUrgency(0)).toBe('overdue');
    expect(deadlineUrgency(-1)).toBe('overdue');
    expect(deadlineUrgency(HOUR - 1)).toBe('urgent');
    expect(deadlineUrgency(HOUR)).toBe('soon');
    expect(deadlineUrgency(24 * HOUR - 1)).toBe('soon');
    expect(deadlineUrgency(24 * HOUR)).toBe('later');
  });
});

describe('relativeTimeLeft', () => {
  it('speaks the locale it is given', () => {
    expect(relativeTimeLeft(2 * HOUR, 'ru')).toMatch(/^через 2/);
    expect(relativeTimeLeft(2 * HOUR, 'en')).toMatch(/^in 2/);
  });

  it('counts minutes under an hour, hours under two days, days beyond — and never «in 0 min»', () => {
    expect(relativeTimeLeft(20_000, 'en')).toMatch(/^in 1 min/);
    expect(relativeTimeLeft(47 * HOUR, 'en')).toMatch(/^in 47 hr/);
    expect(relativeTimeLeft(72 * HOUR, 'en')).toMatch(/^in 3 day/);
    expect(relativeTimeLeft(-3 * HOUR, 'en')).toMatch(/^3 hr\. ago/);
  });
});

describe('DeadlineChip', () => {
  it('says how long, with the exact moment in a time element', () => {
    themed(<DeadlineChip deadline={NOW + 2 * HOUR} locale="ru" now={clock} />);
    const time = document.querySelector('time')!;

    expect(time.textContent).toMatch(/^через 2/);
    expect(time.getAttribute('dateTime')).toBe('2026-09-24T14:00:00.000Z');
    expect(time.getAttribute('title')).toBeTruthy();
    expect(document.querySelector('[data-urgency="soon"]')).toBeTruthy();
  });

  it('says the word it is given once the deadline has passed, coloured as overdue', () => {
    themed(<DeadlineChip deadline={NOW - HOUR} locale="ru" overdueLabel="просрочено" now={clock} />);

    expect(screen.getByText('просрочено')).toBeTruthy();
    expect(document.querySelector('[data-urgency="overdue"]')).toBeTruthy();
  });

  it('draws nothing for a deadline that is not a date, rather than «NaN»', () => {
    const { container } = themed(<DeadlineChip deadline="not a date" now={clock} />);
    expect(container.textContent).toBe('');
  });
});
