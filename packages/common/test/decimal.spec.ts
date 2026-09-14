import { describe, it, expect } from 'vitest';
import {
  addDecimals,
  subtractDecimals,
  multiplyDecimal,
  multiplyDecimals,
  divideDecimal,
  divideDecimals,
  compareDecimals,
  isZero,
  isPositive,
  isNegative,
  isGreater,
  isGreaterOrEqual,
  isLess,
  isLessOrEqual,
  formatDecimal,
  parseDecimal,
  absDecimal,
  minDecimal,
  maxDecimal,
  zero,
  roundDecimal,
  floorDecimal,
  ceilDecimal,
  sumDecimals,
  percentOf,
  satoshisToBtc,
  btcToSatoshis,
  atomicToXmr,
  xmrToAtomic,
  piconerosToXmr,
  xmrToPiconeros,
  isValidDecimal,
  validateAmount,
  Decimal,
  DEFAULT_PRECISION,
} from '../src/decimal.js';

// ============================================================================
// Core Arithmetic
// ============================================================================

describe('Decimal Arithmetic', () => {
  describe('addDecimals', () => {
    it('adds two positive decimals', () => {
      expect(addDecimals('100.50', '25.75')).toBe('126.250000000000');
    });

    it('adds with custom precision', () => {
      expect(addDecimals('1.5', '2.5', 2)).toBe('4.00');
    });

    it('handles zero', () => {
      expect(addDecimals('100', '0')).toBe('100.000000000000');
    });

    it('handles negative numbers', () => {
      expect(addDecimals('100', '-25.5')).toBe('74.500000000000');
    });

    it('handles very small values', () => {
      expect(addDecimals('0.000000000001', '0.000000000001')).toBe('0.000000000002');
    });

    it('handles large values without precision loss', () => {
      expect(addDecimals('999999999999.999999999999', '0.000000000001')).toBe('1000000000000.000000000000');
    });
  });

  describe('subtractDecimals', () => {
    it('subtracts two decimals', () => {
      expect(subtractDecimals('100', '25.50')).toBe('74.500000000000');
    });

    it('produces negative result', () => {
      expect(subtractDecimals('10', '20')).toBe('-10.000000000000');
    });
  });

  describe('multiplyDecimal (string × number)', () => {
    it('multiplies by integer', () => {
      expect(multiplyDecimal('100.50', 2)).toBe('201.000000000000');
    });

    it('multiplies by fraction', () => {
      expect(multiplyDecimal('10', 0.5)).toBe('5.000000000000');
    });
  });

  describe('multiplyDecimals (string × string)', () => {
    it('multiplies two decimals', () => {
      expect(multiplyDecimals('10.5', '2.0')).toBe('21.000000000000');
    });

    it('handles very small multipliers', () => {
      expect(multiplyDecimals('1000', '0.001', 8)).toBe('1.00000000');
    });

    it('uses BigInt exponentiation (no float precision loss)', () => {
      // This would break if using Number(10 ** precision) for large precisions
      expect(multiplyDecimals('1.0', '1.0', 16)).toBe('1.0000000000000000');
    });
  });

  describe('divideDecimals', () => {
    it('divides evenly', () => {
      expect(divideDecimals('100', '4')).toBe('25.000000000000');
    });

    it('produces recurring decimal', () => {
      expect(divideDecimals('100', '3')).toBe('33.333333333333');
    });

    it('throws on division by zero', () => {
      expect(() => divideDecimals('100', '0')).toThrow('Division by zero');
    });
  });

  describe('sumDecimals', () => {
    it('sums an array', () => {
      expect(sumDecimals(['10', '20', '30'])).toBe('60.000000000000');
    });

    it('returns zero for empty array', () => {
      expect(sumDecimals([])).toBe('0.000000000000');
    });

    it('handles mixed precision values', () => {
      expect(sumDecimals(['0.1', '0.2', '0.3'], 2)).toBe('0.60');
    });
  });

  describe('percentOf', () => {
    it('calculates 10% of 200', () => {
      expect(percentOf('200', '10')).toBe('20.000000000000');
    });

    it('calculates 2.5% commission', () => {
      expect(percentOf('1000', '2.5', 8)).toBe('25.00000000');
    });

    it('handles small percentages', () => {
      expect(percentOf('100', '0.01')).toBe('0.010000000000');
    });
  });
});

// ============================================================================
// Comparison
// ============================================================================

describe('Decimal Comparison', () => {
  it('compareDecimals returns correct order', () => {
    expect(compareDecimals('100', '99.99')).toBe(1);
    expect(compareDecimals('50', '50.00')).toBe(0);
    expect(compareDecimals('10', '20')).toBe(-1);
  });

  it('boolean comparators', () => {
    expect(isZero('0')).toBe(true);
    expect(isZero('0.000000000001')).toBe(false);
    expect(isPositive('1')).toBe(true);
    expect(isPositive('-1')).toBe(false);
    expect(isNegative('-1')).toBe(true);
    expect(isGreater('2', '1')).toBe(true);
    expect(isGreaterOrEqual('1', '1')).toBe(true);
    expect(isLess('1', '2')).toBe(true);
    expect(isLessOrEqual('1', '1')).toBe(true);
  });
});

// ============================================================================
// Utility
// ============================================================================

describe('Decimal Utilities', () => {
  it('formatDecimal normalizes', () => {
    expect(formatDecimal('1', 4)).toBe('1.0000');
    expect(formatDecimal('1.1', 4)).toBe('1.1000');
  });

  it('parseDecimal handles numbers', () => {
    expect(parseDecimal(1.5, 4)).toBe('1.5000');
  });

  it('absDecimal', () => {
    expect(absDecimal('-5')).toBe('5.000000000000');
    expect(absDecimal('5')).toBe('5.000000000000');
  });

  it('minDecimal / maxDecimal', () => {
    expect(minDecimal('10', '20')).toBe('10.000000000000');
    expect(maxDecimal('10', '20')).toBe('20.000000000000');
  });

  it('zero', () => {
    expect(zero(4)).toBe('0.0000');
  });

  it('roundDecimal', () => {
    expect(roundDecimal('1.555', 2)).toBe('1.560000000000');
    expect(roundDecimal('1.554', 2)).toBe('1.550000000000');
  });

  it('floorDecimal', () => {
    expect(floorDecimal('1.559', 2)).toBe('1.550000000000');
  });

  it('ceilDecimal', () => {
    expect(ceilDecimal('1.551', 2)).toBe('1.560000000000');
  });
});

// ============================================================================
// Crypto Conversion
// ============================================================================

describe('Cryptocurrency Conversions', () => {
  it('satoshisToBtc', () => {
    expect(satoshisToBtc(100000000n)).toBe('1.00000000');
    expect(satoshisToBtc(1n)).toBe('0.00000001');
    expect(satoshisToBtc(21000000_00000000n)).toBe('21000000.00000000');
  });

  it('btcToSatoshis', () => {
    expect(btcToSatoshis('1.0')).toBe(100000000n);
    expect(btcToSatoshis('0.00000001')).toBe(1n);
  });

  it('atomicToXmr converts piconero, which is what the atomic unit is', () => {
    // These three assertions used to read 100000000n === '1.00000000' — the
    // SATOSHI relationship under a Monero name. One XMR is 10^12 piconero,
    // so the conversion was out by a factor of ten thousand in both
    // directions, and the round-trip test below agreed with it because a
    // round trip agrees with any scale.
    expect(atomicToXmr(1_000_000_000_000n)).toBe('1.000000000000');
    expect(atomicToXmr(1n)).toBe('0.000000000001');
  });

  it('xmrToAtomic', () => {
    expect(xmrToAtomic('1.0')).toBe(1_000_000_000_000n);
    expect(xmrToAtomic('0.000000000001')).toBe(1n);
  });

  it('deprecated aliases still work, and name the unit they convert', () => {
    expect(piconerosToXmr(1_000_000_000_000n)).toBe('1.000000000000');
    expect(xmrToPiconeros('1.0')).toBe(1_000_000_000_000n);
  });

  it('agrees with what payments stores', () => {
    // `coins.precision` is 12 for XMR and 8 for BTC, and the balance columns
    // are `numeric(16,12)`. A conversion helper that disagrees with the
    // column is a helper that cannot be used.
    expect(atomicToXmr(1n).split('.')[1]).toHaveLength(12);
    expect(satoshisToBtc(1n).split('.')[1]).toHaveLength(8);
  });

  it('round-trip BTC conversion', () => {
    const original = '0.12345678';
    expect(satoshisToBtc(btcToSatoshis(original))).toBe(original);
  });

  it('round-trip XMR conversion, at the scale XMR actually has', () => {
    // The old version round-tripped '0.12345678' and passed at ANY scale,
    // which is why it never noticed. Twelve digits do not survive eight.
    const original = '0.123456789012';
    expect(atomicToXmr(xmrToAtomic(original))).toBe(original);
    expect(xmrToAtomic(original)).toBe(123456789012n);
  });
});

// ============================================================================
// Validation
// ============================================================================

describe('Decimal Validation', () => {
  it('isValidDecimal', () => {
    expect(isValidDecimal('123.45')).toBe(true);
    expect(isValidDecimal('-1.5')).toBe(true);
    expect(isValidDecimal('0')).toBe(true);
    expect(isValidDecimal('')).toBe(false);
    expect(isValidDecimal('abc')).toBe(false);
    expect(isValidDecimal('1.2.3')).toBe(false);
  });

  it('validateAmount', () => {
    expect(validateAmount('10', { minAmount: '5' }).valid).toBe(true);
    expect(validateAmount('3', { minAmount: '5' }).valid).toBe(false);
    expect(validateAmount('-1').valid).toBe(false);
    expect(validateAmount('-1', { allowNegative: true }).valid).toBe(true);
    expect(validateAmount('0', { allowZero: false }).valid).toBe(false);
  });
});

// ============================================================================
// Decimal Fluent Class
// ============================================================================

describe('Decimal Class', () => {
  it('fluent arithmetic chain', () => {
    const result = Decimal.from('100')
      .add('50')
      .subtract('25.5')
      .multiply(2)
      .toString();
    expect(result).toBe('249.000000000000');
  });

  it('multiplyBy (string × string)', () => {
    expect(Decimal.from('10').multiplyBy('3').toString()).toBe('30.000000000000');
  });

  it('divideBy', () => {
    expect(Decimal.from('100').divideBy('4').toString()).toBe('25.000000000000');
  });

  it('comparison methods', () => {
    const d = Decimal.from('10');
    expect(d.gt('5')).toBe(true);
    expect(d.lt('20')).toBe(true);
    expect(d.equals('10')).toBe(true);
    expect(d.gte('10')).toBe(true);
    expect(d.lte('10')).toBe(true);
  });

  it('abs / negate', () => {
    expect(Decimal.from('-5').abs().toString()).toBe('5.000000000000');
    expect(Decimal.from('5').negate().toString()).toBe('-5.000000000000');
  });

  it('rounding', () => {
    const d = Decimal.from('1.5678');
    expect(d.round(2).toString()).toBe('1.570000000000');
    expect(d.floor(2).toString()).toBe('1.560000000000');
    expect(d.ceil(2).toString()).toBe('1.570000000000');
  });

  it('zero', () => {
    expect(Decimal.zero(4).toString()).toBe('0.0000');
  });
});

// ============================================================================
// Precision Constants
// ============================================================================

describe('Precision Constants', () => {
  it('DEFAULT_PRECISION is 12', () => {
    expect(DEFAULT_PRECISION).toBe(12);
  });
});

// ============================================================================
// Edge Cases & Regression Guards
// ============================================================================

describe('Edge Cases', () => {
  it('refuses an absent amount rather than reading it as zero', () => {
    // A missing amount is not an amount of zero. The old behaviour turned a
    // failed lookup, an absent column or a dropped field into a free
    // transfer, silently — `addDecimals('', '5')` was `'5.000000000000'`
    // and nothing anywhere said which operand had gone missing.
    for (const absent of ['', '  ', null, undefined]) {
      expect(() => addDecimals(absent as unknown as string, '5'), String(absent)).toThrow(
        /Not a decimal/
      );
    }
  });

  it('refuses a string that is not a decimal, however BigInt would read it', () => {
    // `BigInt` accepts hex, octal and binary literals, and the padded digits
    // made '0x10' one of them: `addDecimals('0x10', '0')` used to return
    // '4503.599627370496'. A sixteen-character string that is not a number,
    // read as four and a half thousand coins.
    for (const junk of ['0x10', '0b101', '0o17', '1e5', '1.2.3', '+1.5', '.5', '5.', 'abc']) {
      expect(() => addDecimals(junk, '0'), junk).toThrow(/Not a decimal/);
      // The validator always said so; the parser is what did not ask it.
      expect(isValidDecimal(junk), junk).toBe(false);
    }
  });

  it('handles string with extra whitespace', () => {
    expect(addDecimals(' 10.5 ', ' 20.5 ')).toBe('31.000000000000');
  });

  it('truncates excess precision (no silent rounding)', () => {
    // 0.1234567890123 with precision=12 should truncate to 0.123456789012
    expect(formatDecimal('0.1234567890123', 12)).toBe('0.123456789012');
  });

  it('float avoidance: 0.1 + 0.2 = 0.3 exactly', () => {
    // Classic floating point trap
    expect(addDecimals('0.1', '0.2')).toBe('0.300000000000');
    expect(compareDecimals(addDecimals('0.1', '0.2'), '0.3')).toBe(0);
  });

  it('large numbers preserve precision', () => {
    const a = '99999999999999.999999999999';
    const b = '0.000000000001';
    expect(addDecimals(a, b)).toBe('100000000000000.000000000000');
  });
});

// ============================================================================
// Quantizing below zero
// ============================================================================

/**
 * Every rounding assertion in this file used a positive number, and all three
 * helpers were wrong below zero — each in its own direction, each contradicting
 * its own docblock. BigInt division truncates TOWARD ZERO, and all three were
 * written as if it truncated downward.
 */
describe('round / floor / ceil below zero', () => {
  it('rounds to the nearest, ties away from zero', () => {
    // Was: -1.9 → -1, -1.5 → -1, -1.1 → 0. The last one is the plainest —
    // a value nine tenths of the way to -1, rounded to nothing at all.
    expect(roundDecimal('-1.9', 0)).toBe('-2.000000000000');
    expect(roundDecimal('-1.5', 0)).toBe('-2.000000000000');
    expect(roundDecimal('-1.1', 0)).toBe('-1.000000000000');
    expect(roundDecimal('1.5', 0)).toBe('2.000000000000');
    expect(roundDecimal('1.1', 0)).toBe('1.000000000000');
  });

  it('floors toward negative infinity, as its name says', () => {
    // Was: -1.5 → -1, which is the ceiling.
    expect(floorDecimal('-1.5', 0)).toBe('-2.000000000000');
    expect(floorDecimal('-1.0', 0)).toBe('-1.000000000000');
    expect(floorDecimal('1.9', 0)).toBe('1.000000000000');
  });

  it('ceils toward positive infinity, as its name says', () => {
    // Was: -1.9 → 0, overshooting past the value's own unit.
    expect(ceilDecimal('-1.9', 0)).toBe('-1.000000000000');
    expect(ceilDecimal('-1.0', 0)).toBe('-1.000000000000');
    expect(ceilDecimal('1.1', 0)).toBe('2.000000000000');
  });

  it('agrees with Math for every tenth across zero', () => {
    // A property, because three hand-picked negatives is how the originals
    // passed: they were all positive.
    // `+ 0` on both sides: this library never emits a negative zero (pinned
    // below), and `Math.ceil(-0.9)` is `-0`, which `Object.is` separates.
    for (let tenths = -30; tenths <= 30; tenths += 1) {
      const value = (tenths / 10).toFixed(1);
      expect(Number(roundDecimal(value, 0)) + 0, `round ${value}`).toBe(
        Math.sign(tenths) * Math.round(Math.abs(tenths) / 10) + 0
      );
      expect(Number(floorDecimal(value, 0)) + 0, `floor ${value}`).toBe(Math.floor(tenths / 10) + 0);
      expect(Number(ceilDecimal(value, 0)) + 0, `ceil ${value}`).toBe(Math.ceil(tenths / 10) + 0);
    }
  });

  it('does not throw when asked for more places than the value carries', () => {
    // `10n ** BigInt(negative)` is a RangeError about exponents, which is not
    // a thing the caller did. Places are clamped into [0, precision].
    expect(roundDecimal('1.5', 20, 12)).toBe('1.500000000000');
    expect(floorDecimal('-1.5', 20, 12)).toBe('-1.500000000000');
    expect(ceilDecimal('1.5', -3, 12)).toBe('2.000000000000');
  });
});

// ============================================================================
// A scale of zero
// ============================================================================

describe('precision 0', () => {
  it('renders an integer, not its digits behind a point', () => {
    // `str.slice(0, -precision)` is `slice(0, 0)` when precision is 0,
    // because `-0 === 0`. `formatDecimal('123', 0)` answered '0.123' — every
    // integer-scale amount off by its own magnitude, and a string no
    // subsequent parse would read back as the same number.
    expect(formatDecimal('123', 0)).toBe('123');
    expect(formatDecimal('0', 0)).toBe('0');
    expect(formatDecimal('-45', 0)).toBe('-45');
    expect(addDecimals('100', '23', 0)).toBe('123');
  });

  it('round-trips through its own parser', () => {
    expect(formatDecimal(formatDecimal('123', 0), 0)).toBe('123');
  });

  it('truncates the fraction rather than carrying it', () => {
    expect(formatDecimal('123.9', 0)).toBe('123');
    expect(roundDecimal('123.9', 0, 0)).toBe('123');
  });
});

// ============================================================================
// Numbers entering a string library
// ============================================================================

describe('a number multiplier or divisor', () => {
  it('survives being small', () => {
    // `BigInt(Math.round(m * 1e8))` made any multiplier below 5e-9 exactly
    // zero, so the amount vanished and the call returned successfully.
    expect(multiplyDecimal('1000000', 1e-9)).toBe('0.001000000000');
    expect(multiplyDecimal('1', 0.000000001)).toBe('0.000000001000');
  });

  it('is not bent by the float that used to scale it', () => {
    // `1.5e-8 * 1e8` is 1.4999999999999998 as a double, so `Math.round` gave
    // 1 and the divisor became 2e-8 — a third larger than the one asked for.
    expect(divideDecimal('1', 1.5e-8)).toBe('66666666.666666666666');
    expect(multiplyDecimal('1', 1.5e-8)).toBe('0.000000015000');
  });

  it('does not throw a RangeError from inside its own zero check', () => {
    // A divisor below 5e-9 became `0n` AFTER `if (divisor === 0)` had passed,
    // and BigInt's own division threw about division by zero — from a
    // function that had just checked for exactly that.
    expect(() => divideDecimal('1', 1e-12)).not.toThrow(RangeError);
    expect(divideDecimal('1', 1e-12)).toBe('1000000000000.000000000000');
    expect(() => divideDecimal('1', 0)).toThrow('Division by zero');
  });

  it('accepts a number in exponent notation through Decimal.from', () => {
    // `String(1e-9)` is '1e-9', which is not a decimal. It used to reach
    // `BigInt` and throw a SyntaxError naming a padded string the caller
    // never wrote.
    expect(Decimal.from(1e-9).toString()).toBe('0.000000001000');
    expect(Decimal.from(1e21).toString()).toBe('1000000000000000000000.000000000000');
    expect(parseDecimal(1e-9)).toBe('0.000000001000');
  });

  it('keeps the fluent API in step with the functions', () => {
    expect(Decimal.from('1000000').multiply(1e-9).toString()).toBe(multiplyDecimal('1000000', 1e-9));
    expect(Decimal.from('1').divide(1.5e-8).toString()).toBe(divideDecimal('1', 1.5e-8));
    expect(Decimal.from('-1.9').round(0).toString()).toBe(roundDecimal('-1.9', 0));
    expect(Decimal.from('-1.5').floor(0).toString()).toBe(floorDecimal('-1.5', 0));
    expect(Decimal.from('-1.9').ceil(0).toString()).toBe(ceilDecimal('-1.9', 0));
  });

  it('never renders a negative zero', () => {
    expect(Decimal.from('-0.0000000000001').toString()).toBe('0.000000000000');
    expect(subtractDecimals('1', '1')).toBe('0.000000000000');
    expect(multiplyDecimal('-1', 0)).toBe('0.000000000000');
  });
});
