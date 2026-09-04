/**
 * Canonical BTC / XMR amount formatting.
 *
 * This module exists because the platform once had eight competing
 * formatters and one dashboard showed three different "truths" for the same
 * balance. It is imported at 14 call sites in the DAOS portal and had no
 * tests — which is how the defects below survived.
 *
 * Money formatting is worth pinning precisely: an off-by-one in the last
 * displayed digit is a user telling support their balance is wrong.
 */

import { describe, it, expect } from 'vitest';

import {
  formatCoinAmount,
  formatCoinAmountList,
  getCoinDecimals,
  sumDecimalStrings,
  toScaledInteger,
  fromScaledInteger,
} from '../format-crypto.js';

describe('formatCoinAmount', () => {
  it('pads to the canonical precision', () => {
    expect(formatCoinAmount('0.001', 'BTC')).toBe('0.00100000 BTC');
    expect(formatCoinAmount('0.001', 'XMR')).toBe('0.00100000 XMR');
  });

  it('treats null, undefined and blank as zero rather than NaN', () => {
    expect(formatCoinAmount(null, 'XMR')).toBe('0.00000000 XMR');
    expect(formatCoinAmount(undefined, 'BTC')).toBe('0.00000000 BTC');
    expect(formatCoinAmount('   ', 'BTC')).toBe('0.00000000 BTC');
    expect(formatCoinAmount('not-a-number', 'BTC')).toBe('0.00000000 BTC');
    expect(formatCoinAmount(Number.NaN, 'BTC')).toBe('0.00000000 BTC');
    expect(formatCoinAmount(Number.POSITIVE_INFINITY, 'BTC')).toBe('0.00000000 BTC');
  });

  it('omits the symbol on request', () => {
    expect(formatCoinAmount('1.23456789', 'BTC', { withSymbol: false })).toBe('1.23456789');
  });

  it('trims trailing zeros when asked, without eating significant digits', () => {
    expect(formatCoinAmount('0.001', 'BTC', { trim: true })).toBe('0.001 BTC');
    expect(formatCoinAmount('100', 'BTC', { trim: true })).toBe('100 BTC');
    expect(formatCoinAmount('10.5', 'BTC', { trim: true })).toBe('10.5 BTC');
    expect(formatCoinAmount('0', 'BTC', { trim: true })).toBe('0 BTC');
  });

  // --- Defects ------------------------------------------------------------

  it('rounds a string amount by its decimal value, not by a float approximation', () => {
    // The module's own docblock promises string input "preserves full
    // precision end-to-end from the RPC wire" — but the string went straight
    // through `Number()`, so it inherited binary floating point. 1.005 is
    // slightly BELOW 1.005 as a double, and toFixed(2) rounded it down to
    // "1.00": a displayed balance one cent short of the stored one.
    expect(formatCoinAmount('1.005', 'BTC', { precision: 2, withSymbol: false })).toBe('1.01');
    expect(formatCoinAmount('2.675', 'BTC', { precision: 2, withSymbol: false })).toBe('2.68');
    expect(formatCoinAmount('0.000000005', 'BTC', { withSymbol: false })).toBe('0.00000001');
  });

  it('keeps every digit of a large amount', () => {
    // 21 million BTC at satoshi precision is 16 significant digits — right at
    // the edge of a double's ~15-17. Formatting must not reach for one.
    expect(formatCoinAmount('20999999.99999999', 'BTC', { withSymbol: false })).toBe('20999999.99999999');
  });

  it('truncates XMR wire precision to display precision without drifting', () => {
    // XMR is stored at 12 fractional digits (piconero) and displayed at 8.
    expect(formatCoinAmount('1234567.123456789012', 'XMR', { withSymbol: false })).toBe('1234567.12345679');
  });

  it('does not read precision off Object.prototype', () => {
    // `COIN_DISPLAY_DECIMALS[coin.toLowerCase()]` is a plain object literal,
    // so a coin code of "constructor" or "toString" returned a FUNCTION,
    // which `?? FALLBACK_DECIMALS` happily accepted — `toFixed(NaN)` then
    // silently formatted with zero decimals instead of eight.
    expect(getCoinDecimals('constructor')).toBe(8);
    expect(getCoinDecimals('toString')).toBe(8);
    expect(formatCoinAmount('1.23456789', 'constructor', { withSymbol: false })).toBe('1.23456789');
  });

  it('never renders a negative zero', () => {
    // "-0 BTC" is not a balance anyone has.
    expect(formatCoinAmount('-0.000000001', 'BTC', { trim: true, withSymbol: false })).toBe('0');
    expect(formatCoinAmount(-0, 'BTC', { withSymbol: false })).toBe('0.00000000');
  });

  it('clamps a negative precision to zero instead of throwing', () => {
    expect(formatCoinAmount('1.9', 'BTC', { precision: -3, withSymbol: false })).toBe('2');
  });

  it('keeps negative amounts negative', () => {
    expect(formatCoinAmount('-1.5', 'BTC', { withSymbol: false })).toBe('-1.50000000');
    expect(formatCoinAmount('-1.5', 'BTC', { trim: true, withSymbol: false })).toBe('-1.5');
  });

  it('honours a custom symbol', () => {
    expect(formatCoinAmount('1', 'BTC', { symbol: '₿', trim: true })).toBe('1 ₿');
  });
});

describe('getCoinDecimals', () => {
  it('is case-insensitive and falls back to 8', () => {
    expect(getCoinDecimals('BTC')).toBe(8);
    expect(getCoinDecimals('xmr')).toBe(8);
    expect(getCoinDecimals('doge')).toBe(8);
  });
});

describe('formatCoinAmountList', () => {
  it('renders a multi-coin total in a stable order', () => {
    expect(formatCoinAmountList({ xmr: '0', btc: '0.0001' })).toBe('0.00010000 BTC · 0.00000000 XMR');
  });

  it('accepts a custom separator and passes options through', () => {
    expect(formatCoinAmountList({ btc: '1', xmr: '2' }, { separator: ', ', trim: true })).toBe('1 BTC, 2 XMR');
  });

  it('renders an empty map as an empty string', () => {
    expect(formatCoinAmountList({})).toBe('');
  });
});

describe('sumDecimalStrings', () => {
  it('adds amounts that a float cannot', () => {
    // The canonical demonstration: `0.1 + 0.2 + 0.3` as doubles is
    // 0.6000000000000001. A formatter capped at eight decimals hides that,
    // but anything showing the raw total — a tooltip, an export, a value
    // posted back — shows the artefact.
    expect(sumDecimalStrings(['0.1', '0.2', '0.3'], 8)).toBe('0.60000000');
  });

  it('carries across the whole number exactly', () => {
    expect(sumDecimalStrings(['0.99999999', '0.00000001'], 8)).toBe('1.00000000');
  });

  it('stays exact where a float accumulator drifts', () => {
    // At eight decimals a float accumulator and this one agree for realistic
    // balances — the divergence appears at wire precision. XMR stores twelve
    // decimals, and there three values are already enough:
    const values = ['12346.678901234567', '23457.789012345678', '34568.890123456789'];

    let drifting = 0;
    for (const value of values) drifting += Number(value);

    expect(sumDecimalStrings(values, 12)).toBe('70373.358037037034');
    expect(drifting.toFixed(12)).toBe('70373.358037037033'); // one piconero short
  });

  it('subtracts, when a value is negative', () => {
    expect(sumDecimalStrings(['1.5', '-0.75'], 8)).toBe('0.75000000');
  });

  it('renders a zero total without a sign', () => {
    expect(sumDecimalStrings(['1.5', '-1.5'], 8)).toBe('0.00000000');
  });

  it('treats absent values as absent, not as junk', () => {
    // A missing balance must not turn the whole total into NaN — which is
    // exactly what a `parseFloat` accumulator does.
    expect(sumDecimalStrings(['1.5', null, undefined, ''], 8)).toBe('1.50000000');
  });

  it('skips values that are not plain decimals', () => {
    expect(sumDecimalStrings(['1.5', 'abc', '1e3'], 8)).toBe('1.50000000');
  });

  it('is zero for nothing at all', () => {
    expect(sumDecimalStrings([], 8)).toBe('0.00000000');
  });

  it('accepts numbers through their decimal representation', () => {
    expect(sumDecimalStrings([1.5, '0.25'], 8)).toBe('1.75000000');
  });

  it('rounds each value half-up at the accumulation scale', () => {
    expect(sumDecimalStrings(['0.005', '0.005'], 2)).toBe('0.02');
  });
});

describe('toScaledInteger / fromScaledInteger', () => {
  it('round-trips a value at its scale', () => {
    expect(fromScaledInteger(toScaledInteger('1.005', 2)!, 2)).toBe('1.01');
  });

  it('scales `1.005` above the double, not below it', () => {
    // `Number('1.005').toFixed(2)` is '1.00' — a balance a cent short of the
    // one actually stored. The whole reason this path exists.
    expect(toScaledInteger('1.005', 2)).toBe(101n);
  });

  it('refuses what it cannot read', () => {
    expect(toScaledInteger('1e3', 8)).toBeNull();
    expect(toScaledInteger('', 8)).toBeNull();
    expect(toScaledInteger('BTC', 8)).toBeNull();
  });

  it('keeps a negative sign through both directions', () => {
    expect(fromScaledInteger(toScaledInteger('-0.5', 8)!, 8)).toBe('-0.50000000');
  });
});
