/**
 * Canonical BTC / XMR amount formatting.
 *
 * This module exists because the platform once had eight competing
 * formatters and one dashboard showed three different "truths" for the same
 * balance. It is imported at 14 call sites in the downstream portal and had no
 * tests — which is how the defects below survived.
 *
 * Money formatting is worth pinning precisely: an off-by-one in the last
 * displayed digit is a user telling support their balance is wrong.
 */

import { describe, it, expect } from 'vitest';

import {
  formatCoinAmount,
  formatCoinAmountList,
  formatDecimalString,
  getCoinDecimals,
  getCoinWireDecimals,
  sumDecimalStrings,
  toScaledInteger,
  fromScaledInteger,
  subtractDecimalStrings,
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

  it('quantizes a string amount by its decimal digits, not by a float', () => {
    // The module's own docblock promises string input "preserves full
    // precision end-to-end from the RPC wire" — but the string went straight
    // through `Number()`, so it inherited binary floating point.
    //
    // The witness is an XMR balance, because that is where a double runs out
    // of digits before the coin does: `Number('1234567.123456789012')` cannot
    // hold what it was handed, and `toFixed(8)` rounds the damage UP. The
    // exact path drops the four digits the column has no room for and leaves
    // the other eight exactly as the ledger holds them.
    expect(Number('1234567.123456789012').toFixed(8)).toBe('1234567.12345679');
    expect(formatCoinAmount('1234567.123456789012', 'XMR', { withSymbol: false })).toBe(
      '1234567.12345678'
    );

    // Half-up is still exact when a caller asks for it — the direction
    // changed for display, not the arithmetic underneath. As a double
    // `'1.005'` sits fractionally BELOW 1.005, so `toFixed(2)` gives '1.00';
    // the decimal digits themselves round to '1.01'.
    expect(Number('1.005').toFixed(2)).toBe('1.00');
    expect(
      formatCoinAmount('1.005', 'BTC', { precision: 2, withSymbol: false, rounding: 'half-up' })
    ).toBe('1.01');
    expect(
      formatCoinAmount('2.675', 'BTC', { precision: 2, withSymbol: false, rounding: 'half-up' })
    ).toBe('2.68');
  });

  it('keeps every digit of a large amount', () => {
    // 21 million BTC at satoshi precision is 16 significant digits — right at
    // the edge of a double's ~15-17. Formatting must not reach for one.
    expect(formatCoinAmount('20999999.99999999', 'BTC', { withSymbol: false })).toBe('20999999.99999999');
  });

  it('truncates XMR wire precision to display precision without drifting', () => {
    // XMR is stored at 12 fractional digits (piconero) and displayed at 8.
    //
    // This assertion used to read `1234567.12345679`: the title said
    // "truncates" and the value pinned a round UP. The title was the part
    // that was right.
    expect(formatCoinAmount('1234567.123456789012', 'XMR', { withSymbol: false })).toBe(
      '1234567.12345678'
    );
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
    // "-0 BTC" is not a balance anyone has. A negative amount too small for
    // the column now reports which side of zero it is on rather than
    // collapsing to a bare '0' — it is real, and the sign is the part that
    // matters. With the marker off it collapses as before, unsigned.
    expect(formatCoinAmount('-0.000000001', 'BTC', { trim: true, withSymbol: false })).toBe(
      '> -0.00000001'
    );
    expect(
      formatCoinAmount('-0.000000001', 'BTC', { trim: true, withSymbol: false, markDust: false })
    ).toBe('0');
    expect(formatCoinAmount(-0, 'BTC', { withSymbol: false })).toBe('0.00000000');
    expect(formatCoinAmount('-0.00000000', 'BTC', { withSymbol: false })).toBe('0.00000000');
  });

  it('clamps a negative precision to zero instead of throwing', () => {
    // And at zero decimals it still truncates: 1.9 BTC is one whole coin and
    // change, not two.
    expect(formatCoinAmount('1.9', 'BTC', { precision: -3, withSymbol: false })).toBe('1');
    expect(
      formatCoinAmount('1.9', 'BTC', { precision: -3, withSymbol: false, rounding: 'half-up' })
    ).toBe('2');
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

describe('subtractDecimalStrings', () => {
  it('is exact where floating point is not', () => {
    // The case a wallet hits on its first render: available = total - locked.
    // `parseFloat('0.30000000') - parseFloat('0.10000000')` is
    // 0.19999999999999998, and `.toString()` shows every digit of it.
    expect(subtractDecimalStrings('0.30000000', ['0.10000000'], 8)).toBe('0.20000000');
    expect(subtractDecimalStrings('1.1', ['0.7'], 8)).toBe('0.40000000');
  });

  it('does not fall into exponential notation on small amounts', () => {
    // `0.00000012 - 0.00000001` through floats is 1.0999999999999999e-7 —
    // not merely imprecise but a shape no balance field accepts.
    const result = subtractDecimalStrings('0.00000012', ['0.00000001'], 8);
    expect(result).toBe('0.00000011');
    expect(result).not.toContain('e');
  });

  it('keeps the digits a 12-decimal coin actually has', () => {
    // Through a float, 12345678.123456789012 rounds to 12345678.12345679 —
    // six digits gone, silently.
    expect(subtractDecimalStrings('12345678.123456789012', ['0.000000000001'], 12)).toBe(
      '12345678.123456789011'
    );
  });

  it('subtracts several values', () => {
    expect(subtractDecimalStrings('1.0', ['0.1', '0.2', '0.3'], 8)).toBe('0.40000000');
  });

  it('clamps at zero only when asked', () => {
    // A negative available balance is a display artefact of two readings
    // taken a moment apart, not a debt — but that is the caller's judgement,
    // not this function's.
    expect(subtractDecimalStrings('1.0', ['2.0'], 8)).toBe('-1.00000000');
    expect(subtractDecimalStrings('1.0', ['2.0'], 8, { clampAtZero: true })).toBe('0.00000000');
  });

  it('returns null when the minuend cannot be read', () => {
    // A difference from an unknown quantity is unknown. Returning '0' here
    // would put a number on the screen that nothing supports.
    for (const bad of [null, undefined, '', 'abc', 'NaN']) {
      expect(subtractDecimalStrings(bad, ['1'], 8), String(bad)).toBeNull();
    }
  });

  it('skips a subtrahend it cannot read rather than poisoning the result', () => {
    expect(subtractDecimalStrings('1.0', ['0.5', 'abc', null, undefined, ''], 8)).toBe('0.50000000');
  });

  it('accepts numbers through their decimal representation', () => {
    expect(subtractDecimalStrings(1.5, [0.5], 8)).toBe('1.00000000');
  });

  it('rounds each operand to the requested scale before subtracting', () => {
    // Inherited from `toScaledInteger`, which is what `sumDecimalStrings`
    // uses too. Worth pinning rather than assuming: at 2 decimals `1.005`
    // becomes 1.01 and `0.001` becomes 0, so the result is 1.01 and not
    // 1.004. A caller who needs the full value passes the coin's own
    // precision, which is what `getCoinDecimals` is for.
    expect(subtractDecimalStrings('1.005', ['0.001'], 2)).toBe('1.01');
    expect(subtractDecimalStrings('1.005', ['0.001'], 8)).toBe('1.00400000');
  });

  it('never returns negative zero', () => {
    expect(subtractDecimalStrings('1.0', ['1.0'], 8)).toBe('0.00000000');
    expect(subtractDecimalStrings('1.0', ['1.0'], 8)).not.toContain('-');
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

// ---------------------------------------------------------------------------
// The direction a dropped digit goes
// ---------------------------------------------------------------------------

/**
 * The defect this section exists for: an XMR balance of `1.586170199999`
 * rendered as `1.58617020` — a tenth of a piconero MORE than the account
 * holds. Somebody who reads that number and types it into a withdrawal is
 * refused for insufficient funds, by a figure the platform put on their own
 * screen. The same arithmetic seeds the "max balance" shortcut, so the
 * refusal arrives from a button whose whole purpose is to be correct.
 */
describe('a rendered amount is never more than the amount that exists', () => {
  it('shows the balance that produced this rule', () => {
    expect(formatCoinAmount('1.586170199999', 'XMR', { withSymbol: false })).toBe('1.58617019');
  });

  it('holds for the sign below zero as well, by magnitude', () => {
    // Toward zero, not toward negative infinity: the displayed magnitude
    // never exceeds the real one in either direction.
    expect(formatCoinAmount('-1.586170199999', 'XMR', { withSymbol: false })).toBe('-1.58617019');
  });

  it('holds for arbitrary amounts, not the ones chosen for this test', () => {
    // A property rather than an example. The comparison is made at wire
    // scale with `toScaledInteger`, which quantizes nothing here because the
    // generated values have exactly twelve digits — so the check does not
    // inherit the behaviour it is checking.
    let seed = 20260914 >>> 0;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };

    for (let i = 0; i < 500; i += 1) {
      const whole = Math.floor(next() * 21_000_000);
      const frac = String(Math.floor(next() * 1_000_000_000_000)).padStart(12, '0');
      const raw = `${whole}.${frac}`;

      const shown = formatCoinAmount(raw, 'XMR', { withSymbol: false, markDust: false });
      const exact = toScaledInteger(raw, 12)!;
      const displayed = toScaledInteger(shown, 12)!;

      // Never more than what is there …
      expect(displayed, raw).toBeLessThanOrEqual(exact);
      // … and never less by as much as one displayed unit, which would mean
      // a digit the column CAN show was thrown away. 1e-8 at scale 12.
      expect(exact - displayed, raw).toBeLessThan(10_000n);
    }
  });

  it('leaves a value that already fits completely alone', () => {
    expect(formatCoinAmount('20999999.99999999', 'BTC', { withSymbol: false })).toBe(
      '20999999.99999999'
    );
    expect(formatCoinAmount('0.00000001', 'XMR', { withSymbol: false })).toBe('0.00000001');
  });
});

// ---------------------------------------------------------------------------
// An amount too small for the column
// ---------------------------------------------------------------------------

describe('an amount smaller than the last displayed digit', () => {
  it('says it is below the threshold rather than reporting nothing', () => {
    // Truncation alone turns 0.000000004916 XMR into '0.00000000' — the
    // mirror of the defect above: a balance that exists, shown as none.
    expect(formatCoinAmount('0.000000004916', 'XMR')).toBe('< 0.00000001 XMR');
    expect(formatCoinAmount('0.000000004916', 'XMR', { withSymbol: false })).toBe('< 0.00000001');
  });

  it('keeps the sign of a dust amount below zero', () => {
    expect(formatCoinAmount('-0.000000004916', 'XMR', { withSymbol: false })).toBe('> -0.00000001');
    expect(formatCoinAmount('-0.000000004916', 'XMR')).toBe('> -0.00000001 XMR');
  });

  it('still renders a true zero as a zero', () => {
    for (const zero of ['0', '0.000000000000', '-0', '0.0']) {
      expect(formatCoinAmount(zero, 'XMR', { withSymbol: false }), zero).toBe('0.00000000');
    }
    expect(formatCoinAmount(null, 'XMR', { withSymbol: false })).toBe('0.00000000');
    expect(formatCoinAmount(0, 'XMR', { withSymbol: false })).toBe('0.00000000');
  });

  it('is switchable off where the output has to be a bare numeral', () => {
    expect(
      formatCoinAmount('0.000000004916', 'XMR', { withSymbol: false, markDust: false })
    ).toBe('0.00000000');
  });

  it('does not claim dust for input it could not read', () => {
    // `1e-30` is a real amount, but this module refuses exponent notation
    // everywhere; calling it dust would be claiming to have parsed it.
    expect(formatCoinAmount('1e-30', 'BTC', { withSymbol: false })).toBe('0.00000000');
    expect(formatCoinAmount('abc5', 'BTC', { withSymbol: false })).toBe('0.00000000');
    expect(formatCoinAmount('   ', 'BTC', { withSymbol: false })).toBe('0.00000000');
  });

  it('scales the threshold with the precision actually asked for', () => {
    expect(formatCoinAmount('0.004', 'BTC', { precision: 2, withSymbol: false })).toBe('< 0.01');
    expect(formatCoinAmount('0.4', 'BTC', { precision: 0, withSymbol: false })).toBe('< 1');
  });

  it('is not applied to a number the float path had to handle', () => {
    // `Number.MIN_VALUE` stringifies to exponent notation, so it takes the
    // fallback; the marker only speaks for values this module parsed itself.
    expect(formatCoinAmount(Number.MIN_VALUE, 'BTC', { withSymbol: false })).toBe('0.00000000');
  });
});

// ---------------------------------------------------------------------------
// Wire precision versus display precision
// ---------------------------------------------------------------------------

describe('wire precision is a different question from display precision', () => {
  it('knows that XMR stores four digits it does not show', () => {
    expect(getCoinDecimals('xmr')).toBe(8);
    expect(getCoinWireDecimals('xmr')).toBe(12);
    expect(getCoinDecimals('btc')).toBe(8);
    expect(getCoinWireDecimals('btc')).toBe(8);
  });

  it('is case-insensitive and prototype-free, like its display twin', () => {
    expect(getCoinWireDecimals('XMR')).toBe(12);
    expect(getCoinWireDecimals('constructor')).toBe(12);
    expect(getCoinWireDecimals('toString')).toBe(12);
  });

  it('falls back WIDE where the display scale falls back narrow', () => {
    // An unknown coin's digits survive arithmetic done at a scale too wide.
    // At a scale too narrow they are gone before the first operation and
    // nothing downstream can tell.
    expect(getCoinWireDecimals('doge')).toBe(12);
    expect(getCoinDecimals('doge')).toBe(8);
  });

  it('is the scale that keeps an available balance honest', () => {
    // The wallet's own sum: available = total − locked. Computed at DISPLAY
    // scale, both operands are quantized before the subtraction and the
    // answer comes out above what the ledger will release. Computed at wire
    // scale it is exact, and the single quantization at the end goes down.
    const total = '1.586170199999';
    const locked = '0.000000000009';

    expect(subtractDecimalStrings(total, [locked], getCoinDecimals('xmr'))).toBe('1.58617020');
    expect(subtractDecimalStrings(total, [locked], getCoinWireDecimals('xmr'))).toBe(
      '1.586170199990'
    );
    expect(
      formatCoinAmount(subtractDecimalStrings(total, [locked], getCoinWireDecimals('xmr')), 'XMR', {
        withSymbol: false,
      })
    ).toBe('1.58617019');
  });
});

// ---------------------------------------------------------------------------
// Rendering and arithmetic disagree on purpose
// ---------------------------------------------------------------------------

describe('formatDecimalString renders; toScaledInteger computes', () => {
  it('defaults in opposite directions, and both are overridable', () => {
    expect(formatDecimalString('1.005', 2)).toBe('1.00');
    expect(toScaledInteger('1.005', 2)).toBe(101n);

    expect(formatDecimalString('1.005', 2, 'half-up')).toBe('1.01');
    expect(toScaledInteger('1.005', 2, 'down')).toBe(100n);
  });

  it('keeps the renderer returning a plain parseable decimal', () => {
    // `AmountCell` and payments's `formatCryptoAmount` both feed this result
    // back into `Number()`. The `< 0.00000001` form belongs to
    // `formatCoinAmount`, which renders prose rather than a numeral.
    const out = formatDecimalString('0.000000004916', 8);
    expect(out).toBe('0.00000000');
    expect(Number.isNaN(Number(out))).toBe(false);
    expect(out).not.toContain('<');
  });

  it('truncates toward zero on both sides', () => {
    expect(formatDecimalString('-1.999', 2)).toBe('-1.99');
    expect(formatDecimalString('1.999', 2)).toBe('1.99');
  });
});

describe('rounding is reachable from the accumulators too', () => {
  it('sums down when a caller has to accumulate at display scale', () => {
    // Two amounts that each round up at scale 2 make a total above what
    // exists; at 'down' the total is never more than the parts.
    expect(sumDecimalStrings(['0.005', '0.005'], 2)).toBe('0.02');
    expect(sumDecimalStrings(['0.005', '0.005'], 2, { rounding: 'down' })).toBe('0.00');
  });

  it('subtracts down when asked', () => {
    expect(subtractDecimalStrings('1.005', ['0.001'], 2)).toBe('1.01');
    expect(subtractDecimalStrings('1.005', ['0.001'], 2, { rounding: 'down' })).toBe('1.00');
  });

  it('leaves clampAtZero working alongside it', () => {
    expect(
      subtractDecimalStrings('1.0', ['2.0'], 8, { clampAtZero: true, rounding: 'down' })
    ).toBe('0.00000000');
  });
});
