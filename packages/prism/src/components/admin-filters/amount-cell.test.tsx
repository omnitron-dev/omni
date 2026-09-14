/**
 * AmountCell — the cell financial tables render amounts in.
 *
 * It takes the amount as a STRING specifically so wire precision survives to
 * the screen. These tests pin that it actually does, and that the thousands
 * separators, sign and currency suffix behave.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { AmountCell } from './amount-cell.js';

/** The rendered text with the currency suffix stripped. */
function amountText(): string {
  return screen.getByText(/[\d,.-]/).textContent ?? '';
}

describe('AmountCell', () => {
  it('renders the string unchanged when no precision is requested', () => {
    render(<AmountCell amount="1234.56789" />);
    expect(screen.getByText(/1,234\.56789/)).toBeInTheDocument();
  });

  it('groups thousands in the integer part only', () => {
    render(<AmountCell amount="1234567.891" />);
    expect(screen.getByText(/1,234,567\.891/)).toBeInTheDocument();
  });

  it('scales to the requested precision by decimal value, not float', () => {
    // The witness is an XMR balance shown at display precision, because that
    // is where a double runs out of digits before the coin does:
    // `Number('1234567.123456789012').toFixed(8)` is '1234567.12345679' — it
    // cannot hold the value it was handed and rounds the damage UP. The
    // decimal path drops the four digits this column has no room for and
    // leaves the eight it does have exactly as the ledger holds them.
    render(<AmountCell amount="1234567.123456789012" decimals={8} />);
    expect(screen.getByText(/^1,234,567\.12345678$/)).toBeInTheDocument();
  });

  it('never shows more money than the amount it was given', () => {
    // This cell is for financial tables. A figure rounded UP is one a person
    // can read off the screen, type into a withdrawal, and be refused for.
    // `1.005` at two decimals is one whole unit and a half-cent, not 1.01.
    const { unmount } = render(<AmountCell amount="1.005" decimals={2} />);
    expect(screen.getByText(/^1\.00$/)).toBeInTheDocument();
    unmount();

    // Toward zero on the other side of it, too.
    render(<AmountCell amount="-1.999" decimals={2} />);
    expect(screen.getByText(/^-1\.99$/)).toBeInTheDocument();
  });

  it('keeps every digit of a high-precision amount', () => {
    // The docblock's own example: XMR at 12 fractional digits, where a
    // double has already run out of significant figures.
    render(<AmountCell amount="1234567.123456789012" decimals={12} />);
    expect(screen.getByText(/1,234,567\.123456789012/)).toBeInTheDocument();
  });

  it('keeps satoshi-level precision on a large BTC amount', () => {
    render(<AmountCell amount="20999999.99999999" decimals={8} />);
    expect(screen.getByText(/20,999,999\.99999999/)).toBeInTheDocument();
  });

  it('renders a negative amount with its sign, grouped', () => {
    render(<AmountCell amount="-1234.5" decimals={2} />);
    expect(screen.getByText(/^-1,234\.50/)).toBeInTheDocument();
  });

  it('prefixes a positive amount only when asked', () => {
    const { unmount } = render(<AmountCell amount="10" showSign />);
    expect(screen.getByText(/^\+10/)).toBeInTheDocument();
    unmount();

    render(<AmountCell amount="10" />);
    expect(amountText().startsWith('+')).toBe(false);
  });

  it('renders the currency as a suffix', () => {
    render(<AmountCell amount="1.5" currency="BTC" decimals={8} />);
    expect(screen.getByText('BTC')).toBeInTheDocument();
    expect(screen.getByText(/1\.50000000/)).toBeInTheDocument();
  });

  it('passes a non-numeric amount through untouched', () => {
    render(<AmountCell amount="n/a" />);
    expect(screen.getByText('n/a')).toBeInTheDocument();
  });
});
