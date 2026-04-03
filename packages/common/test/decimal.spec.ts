import { describe, it, expect } from 'vitest';
import {
  addDecimals,
  subtractDecimals,
  multiplyDecimal,
  multiplyDecimals,
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

  it('atomicToXmr (8 decimals)', () => {
    expect(atomicToXmr(100000000n)).toBe('1.00000000');
    expect(atomicToXmr(1n)).toBe('0.00000001');
  });

  it('xmrToAtomic', () => {
    expect(xmrToAtomic('1.0')).toBe(100000000n);
    expect(xmrToAtomic('0.00000001')).toBe(1n);
  });

  it('deprecated aliases still work', () => {
    expect(piconerosToXmr(100000000n)).toBe('1.00000000');
    expect(xmrToPiconeros('1.0')).toBe(100000000n);
  });

  it('round-trip BTC conversion', () => {
    const original = '0.12345678';
    expect(satoshisToBtc(btcToSatoshis(original))).toBe(original);
  });

  it('round-trip XMR conversion', () => {
    const original = '0.12345678';
    expect(atomicToXmr(xmrToAtomic(original))).toBe(original);
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
  it('empty string treated as zero', () => {
    expect(addDecimals('', '5')).toBe('5.000000000000');
    expect(addDecimals('  ', '5')).toBe('5.000000000000');
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
