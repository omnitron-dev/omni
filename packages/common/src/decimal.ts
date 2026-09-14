/**
 * Decimal - Precise Decimal Arithmetic Utilities
 *
 * String-based decimal arithmetic using BigInt internally for precision.
 * Designed for financial calculations where floating point errors are unacceptable.
 *
 * Features:
 * - No floating point precision issues
 * - Configurable decimal precision
 * - Standard arithmetic operations (add, subtract, multiply, divide)
 * - Comparison and validation utilities
 * - Currency-specific helpers (BTC, XMR with predefined precision)
 *
 * @example
 * ```typescript
 * import { Decimal, addDecimals, compareDecimals } from '@omnitron-dev/common';
 *
 * // Basic arithmetic
 * const sum = addDecimals('100.50', '25.75'); // => '126.250000000000'
 * const diff = subtractDecimals('100', '75.5'); // => '24.500000000000'
 *
 * // Comparison
 * const isMore = compareDecimals('100', '99.99'); // => 1 (100 > 99.99)
 *
 * // With Decimal class (fluent API)
 * const result = Decimal.from('100')
 *   .add('50')
 *   .subtract('25.5')
 *   .multiply(2)
 *   .toString(); // => '249.000000000000'
 * ```
 *
 * @module @omnitron-dev/common/decimal
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Default precision for decimal operations (12 decimal places)
 */
export const DEFAULT_PRECISION = 12;

// ============================================================================
// Core Arithmetic Functions
// ============================================================================

/**
 * Add two decimal strings with specified precision
 *
 * @param a - First decimal string
 * @param b - Second decimal string
 * @param precision - Number of decimal places (default: 12)
 * @returns Sum as decimal string
 *
 * @example
 * ```typescript
 * addDecimals('100.50', '25.75') // => '126.250000000000'
 * addDecimals('1.5', '2.5', 2) // => '4.00'
 * ```
 */
export function addDecimals(a: string, b: string, precision: number = DEFAULT_PRECISION): string {
  const aInt = decimalToInt(a, precision);
  const bInt = decimalToInt(b, precision);
  const result = aInt + bInt;
  return intToDecimal(result, precision);
}

/**
 * Subtract two decimal strings with specified precision
 *
 * @param a - First decimal string (minuend)
 * @param b - Second decimal string (subtrahend)
 * @param precision - Number of decimal places (default: 12)
 * @returns Difference (a - b) as decimal string
 *
 * @example
 * ```typescript
 * subtractDecimals('100', '25.50') // => '74.500000000000'
 * ```
 */
export function subtractDecimals(a: string, b: string, precision: number = DEFAULT_PRECISION): string {
  const aInt = decimalToInt(a, precision);
  const bInt = decimalToInt(b, precision);
  const result = aInt - bInt;
  return intToDecimal(result, precision);
}

/**
 * Multiply a decimal string by a multiplier
 *
 * @param a - Decimal string
 * @param multiplier - Number to multiply by
 * @param precision - Number of decimal places (default: 12)
 * @returns Product as decimal string
 *
 * @example
 * ```typescript
 * multiplyDecimal('100.50', 2) // => '201.000000000000'
 * multiplyDecimal('10', 0.5) // => '5.000000000000'
 * ```
 */
export function multiplyDecimal(a: string, multiplier: number, precision: number = DEFAULT_PRECISION): string {
  // The multiplier goes through its own decimal representation, at the same
  // scale as everything else. It used to be `BigInt(Math.round(m * 1e8))`,
  // which is a float multiplication in the middle of a library whose entire
  // purpose is not doing one, and it had two consequences: any multiplier
  // below 5e-9 rounded to zero and silently annihilated the amount, and
  // `1.5e-8 * 1e8` is 1.4999999999999998 as a double, so a rate landed on
  // the wrong side of `Math.round` and came out a third smaller than asked.
  return multiplyDecimals(a, numberToDecimalString(multiplier), precision);
}

/**
 * Multiply two decimal strings
 *
 * @param a - First decimal string
 * @param b - Second decimal string
 * @param precision - Number of decimal places (default: 12)
 * @returns Product as decimal string
 *
 * @example
 * ```typescript
 * multiplyDecimals('10.5', '2.0') // => '21.000000000000'
 * ```
 */
export function multiplyDecimals(a: string, b: string, precision: number = DEFAULT_PRECISION): string {
  const aInt = decimalToInt(a, precision);
  const bInt = decimalToInt(b, precision);
  const scale = BigInt(10) ** BigInt(precision);
  const result = (aInt * bInt) / scale;
  return intToDecimal(result, precision);
}

/**
 * Divide a decimal string by a divisor
 *
 * @param a - Dividend decimal string
 * @param divisor - Number to divide by
 * @param precision - Number of decimal places (default: 12)
 * @returns Quotient as decimal string
 * @throws Error if divisor is zero
 *
 * @example
 * ```typescript
 * divideDecimal('100', 3) // => '33.333333333333'
 * ```
 */
export function divideDecimal(a: string, divisor: number, precision: number = DEFAULT_PRECISION): string {
  if (divisor === 0) {
    throw new Error('Division by zero');
  }
  // Same fixed 1e8 float scale as `multiplyDecimal` had, and here it was
  // worse: a divisor below 5e-9 became `0n`, so the guard above passed and
  // the BigInt division threw a `RangeError` about division by zero from
  // inside a function that had just checked for exactly that.
  return divideDecimals(a, numberToDecimalString(divisor), precision);
}

/**
 * Divide two decimal strings
 *
 * @param a - Dividend decimal string
 * @param b - Divisor decimal string
 * @param precision - Number of decimal places (default: 12)
 * @returns Quotient as decimal string
 * @throws Error if divisor is zero
 *
 * @example
 * ```typescript
 * divideDecimals('100', '3') // => '33.333333333333'
 * ```
 */
export function divideDecimals(a: string, b: string, precision: number = DEFAULT_PRECISION): string {
  const bInt = decimalToInt(b, precision);
  if (bInt === 0n) {
    throw new Error('Division by zero');
  }
  const aInt = decimalToInt(a, precision);
  const scale = BigInt(10) ** BigInt(precision);
  const result = (aInt * scale) / bInt;
  return intToDecimal(result, precision);
}

/**
 * Sum an array of decimal strings
 */
export function sumDecimals(values: string[], precision: number = DEFAULT_PRECISION): string {
  let total = 0n;
  for (const v of values) {
    total += decimalToInt(v, precision);
  }
  return intToDecimal(total, precision);
}

/**
 * Calculate percentage of an amount: amount * percent / 100
 * Both amount and percent are decimal strings.
 */
export function percentOf(amount: string, percent: string, precision: number = DEFAULT_PRECISION): string {
  const amountInt = decimalToInt(amount, precision);
  const percentInt = decimalToInt(percent, precision);
  const scale = BigInt(10) ** BigInt(precision);
  const hundredInt = 100n * scale;
  const result = (amountInt * percentInt) / hundredInt;
  return intToDecimal(result, precision);
}

// ============================================================================
// Comparison Functions
// ============================================================================

/**
 * Compare two decimal strings
 *
 * @param a - First decimal string
 * @param b - Second decimal string
 * @param precision - Number of decimal places (default: 12)
 * @returns -1 if a < b, 0 if a === b, 1 if a > b
 *
 * @example
 * ```typescript
 * compareDecimals('100', '99.99') // => 1
 * compareDecimals('50', '50.00') // => 0
 * compareDecimals('10', '20') // => -1
 * ```
 */
export function compareDecimals(a: string, b: string, precision: number = DEFAULT_PRECISION): -1 | 0 | 1 {
  const aInt = decimalToInt(a, precision);
  const bInt = decimalToInt(b, precision);
  if (aInt < bInt) return -1;
  if (aInt > bInt) return 1;
  return 0;
}

/**
 * Check if decimal is zero
 */
export function isZero(value: string, precision: number = DEFAULT_PRECISION): boolean {
  return decimalToInt(value, precision) === 0n;
}

/**
 * Check if decimal is positive (> 0)
 */
export function isPositive(value: string, precision: number = DEFAULT_PRECISION): boolean {
  return decimalToInt(value, precision) > 0n;
}

/**
 * Check if decimal is negative (< 0)
 */
export function isNegative(value: string, precision: number = DEFAULT_PRECISION): boolean {
  return decimalToInt(value, precision) < 0n;
}

/**
 * Check if a >= b
 */
export function isGreaterOrEqual(a: string, b: string, precision: number = DEFAULT_PRECISION): boolean {
  return compareDecimals(a, b, precision) >= 0;
}

/**
 * Check if a > b
 */
export function isGreater(a: string, b: string, precision: number = DEFAULT_PRECISION): boolean {
  return compareDecimals(a, b, precision) > 0;
}

/**
 * Check if a <= b
 */
export function isLessOrEqual(a: string, b: string, precision: number = DEFAULT_PRECISION): boolean {
  return compareDecimals(a, b, precision) <= 0;
}

/**
 * Check if a < b
 */
export function isLess(a: string, b: string, precision: number = DEFAULT_PRECISION): boolean {
  return compareDecimals(a, b, precision) < 0;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format decimal string to fixed precision with trailing zeros
 */
export function formatDecimal(value: string, precision: number = DEFAULT_PRECISION): string {
  const int = decimalToInt(value, precision);
  return intToDecimal(int, precision);
}

/**
 * Parse a decimal string or number to normalized format
 */
export function parseDecimal(value: string | number, precision: number = DEFAULT_PRECISION): string {
  const str = typeof value === 'number' ? numberToDecimalString(value) : value;
  return formatDecimal(str, precision);
}

/**
 * Get absolute value of decimal
 */
export function absDecimal(value: string, precision: number = DEFAULT_PRECISION): string {
  const int = decimalToInt(value, precision);
  return intToDecimal(int < 0n ? -int : int, precision);
}

/**
 * Get minimum of two decimals
 */
export function minDecimal(a: string, b: string, precision: number = DEFAULT_PRECISION): string {
  return compareDecimals(a, b, precision) <= 0 ? formatDecimal(a, precision) : formatDecimal(b, precision);
}

/**
 * Get maximum of two decimals
 */
export function maxDecimal(a: string, b: string, precision: number = DEFAULT_PRECISION): string {
  return compareDecimals(a, b, precision) >= 0 ? formatDecimal(a, precision) : formatDecimal(b, precision);
}

/**
 * Get zero value with specified precision
 */
export function zero(precision: number = DEFAULT_PRECISION): string {
  return intToDecimal(0n, precision);
}

/**
 * Round decimal to specified decimal places
 */
export function roundDecimal(value: string, decimalPlaces: number, precision: number = DEFAULT_PRECISION): string {
  // Ties away from zero, symmetric about it. `((int + scale/2n) / scale)`
  // relied on BigInt division, which truncates TOWARD zero, so every
  // negative value was pulled up by as much as a whole unit at the requested
  // scale: `roundDecimal('-1.9', 0)` was `-1`, and `roundDecimal('-1.1', 0)`
  // was `0`. Only positive numbers were ever tested.
  const scale = quantizeScale(decimalPlaces, precision);
  return intToDecimal(divRoundHalfUp(decimalToInt(value, precision), scale) * scale, precision);
}

/**
 * Floor decimal to specified decimal places (round towards negative infinity)
 */
export function floorDecimal(value: string, decimalPlaces: number, precision: number = DEFAULT_PRECISION): string {
  // Toward negative infinity, as the name and the docblock both said and
  // neither did: BigInt division truncates toward ZERO, so `floorDecimal
  // ('-1.5', 0)` answered `-1`.
  const scale = quantizeScale(decimalPlaces, precision);
  return intToDecimal(divFloor(decimalToInt(value, precision), scale) * scale, precision);
}

/**
 * Ceiling decimal to specified decimal places (round towards positive infinity)
 */
export function ceilDecimal(value: string, decimalPlaces: number, precision: number = DEFAULT_PRECISION): string {
  // Toward positive infinity. The `+ scale - 1n` trick is a ceiling only for
  // non-negative values; below zero it overshot into the next unit, so
  // `ceilDecimal('-1.9', 0)` answered `0` where the ceiling is `-1`.
  const scale = quantizeScale(decimalPlaces, precision);
  return intToDecimal(divCeil(decimalToInt(value, precision), scale) * scale, precision);
}

// ============================================================================
// Cryptocurrency Conversion Helpers
// ============================================================================

/** BTC: 8 decimal places (1 satoshi = 10^-8 BTC) */
const BTC_DECIMALS = 8;
/**
 * XMR: 12 decimal places. The atomic unit of Monero is the piconero and
 * 1 XMR is 10^12 of them — the same relationship the satoshi has to BTC at
 * 10^8, and the same one `coins.precision` records in payments.
 *
 * This constant said 8, with a comment explaining that "standard display
 * uses 8". Display convention is a real thing and it is not this: these two
 * functions convert between an on-chain integer and a coin amount, and at a
 * scale of 8 the conversion was wrong by a factor of ten thousand in both
 * directions. `atomicToXmr(1_000_000_000_000n)` — one whole XMR — returned
 * `'10000.00000000'`; `xmrToAtomic('1')` returned a hundred million
 * piconero, which is 0.0001 XMR. The deprecated aliases name the unit in as
 * many words: `piconerosToXmr`, `xmrToPiconeros`.
 *
 * Nothing in either repository called them, which is the only reason this
 * could sit in a shared package. The library's own tests pinned it:
 * `atomicToXmr(100000000n) === '1.00000000'` is the satoshi relationship
 * under a Monero name, and the round-trip test round-trips at any scale, so
 * it agreed.
 */
const XMR_DECIMALS = 12;

/**
 * Convert satoshis (smallest Bitcoin unit) to BTC string
 */
export function satoshisToBtc(satoshis: bigint | number | string): string {
  const sats = typeof satoshis === 'bigint' ? satoshis : BigInt(satoshis);
  return intToDecimal(sats, BTC_DECIMALS);
}

/**
 * Convert BTC string to satoshis
 */
export function btcToSatoshis(btc: string): bigint {
  return decimalToInt(btc, BTC_DECIMALS);
}

/**
 * Convert atomic XMR units (piconero) to an XMR string.
 */
export function atomicToXmr(atomic: bigint | number | string): string {
  const val = typeof atomic === 'bigint' ? atomic : BigInt(atomic);
  return intToDecimal(val, XMR_DECIMALS);
}

/**
 * Convert XMR string to atomic units
 */
export function xmrToAtomic(xmr: string): bigint {
  return decimalToInt(xmr, XMR_DECIMALS);
}

/**
 * @deprecated Use atomicToXmr instead
 */
export const piconerosToXmr = atomicToXmr;

/**
 * @deprecated Use xmrToAtomic instead
 */
export const xmrToPiconeros = xmrToAtomic;

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Check if string is a valid decimal number
 */
export function isValidDecimal(value: string): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }
  // Match optional negative, digits, optional decimal point with digits
  return /^-?\d+(\.\d+)?$/.test(value.trim());
}

/**
 * Validation result type
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate amount is positive and within reasonable bounds
 */
export function validateAmount(
  amount: string,
  options: {
    minAmount?: string;
    maxAmount?: string;
    precision?: number;
    allowZero?: boolean;
    allowNegative?: boolean;
  } = {}
): ValidationResult {
  const { minAmount, maxAmount, precision = DEFAULT_PRECISION, allowZero = true, allowNegative = false } = options;

  if (!isValidDecimal(amount)) {
    return { valid: false, error: 'Invalid decimal format' };
  }

  if (!allowNegative && isNegative(amount, precision)) {
    return { valid: false, error: 'Amount must be non-negative' };
  }

  if (!allowZero && isZero(amount, precision)) {
    return { valid: false, error: 'Amount must not be zero' };
  }

  if (minAmount && compareDecimals(amount, minAmount, precision) < 0) {
    return { valid: false, error: `Amount must be at least ${minAmount}` };
  }

  if (maxAmount && compareDecimals(amount, maxAmount, precision) > 0) {
    return { valid: false, error: `Amount must not exceed ${maxAmount}` };
  }

  return { valid: true };
}

// ============================================================================
// Decimal Class (Fluent API)
// ============================================================================

/**
 * Decimal class providing a fluent API for decimal arithmetic
 *
 * @example
 * ```typescript
 * const result = Decimal.from('100')
 *   .add('50')
 *   .subtract('25.5')
 *   .multiply(2)
 *   .divide(4)
 *   .toString();
 * ```
 */
export class Decimal {
  private readonly value: bigint;
  private readonly precision: number;

  private constructor(value: bigint, precision: number) {
    this.value = value;
    this.precision = precision;
  }

  /**
   * Create a Decimal from a string or number
   */
  static from(value: string | number, precision: number = DEFAULT_PRECISION): Decimal {
    const str = typeof value === 'number' ? numberToDecimalString(value) : value;
    const int = decimalToInt(str, precision);
    return new Decimal(int, precision);
  }

  /**
   * Create a Decimal representing zero
   */
  static zero(precision: number = DEFAULT_PRECISION): Decimal {
    return new Decimal(0n, precision);
  }

  /**
   * Add another decimal
   */
  add(other: string | number | Decimal): Decimal {
    const otherInt = other instanceof Decimal ? other.value : decimalToInt(toDecimalString(other), this.precision);
    return new Decimal(this.value + otherInt, this.precision);
  }

  /**
   * Subtract another decimal
   */
  subtract(other: string | number | Decimal): Decimal {
    const otherInt = other instanceof Decimal ? other.value : decimalToInt(toDecimalString(other), this.precision);
    return new Decimal(this.value - otherInt, this.precision);
  }

  /**
   * Multiply by a number
   */
  multiply(multiplier: number): Decimal {
    return this.multiplyBy(numberToDecimalString(multiplier));
  }

  /**
   * Multiply by another decimal
   */
  multiplyBy(other: string | number | Decimal): Decimal {
    const otherInt = other instanceof Decimal ? other.value : decimalToInt(toDecimalString(other), this.precision);
    const scale = BigInt(10) ** BigInt(this.precision);
    const result = (this.value * otherInt) / scale;
    return new Decimal(result, this.precision);
  }

  /**
   * Divide by a number
   */
  divide(divisor: number): Decimal {
    if (divisor === 0) {
      throw new Error('Division by zero');
    }
    return this.divideBy(numberToDecimalString(divisor));
  }

  /**
   * Divide by another decimal
   */
  divideBy(other: string | number | Decimal): Decimal {
    const otherInt = other instanceof Decimal ? other.value : decimalToInt(toDecimalString(other), this.precision);
    if (otherInt === 0n) {
      throw new Error('Division by zero');
    }
    const scale = BigInt(10) ** BigInt(this.precision);
    const result = (this.value * scale) / otherInt;
    return new Decimal(result, this.precision);
  }

  /**
   * Get absolute value
   */
  abs(): Decimal {
    return new Decimal(this.value < 0n ? -this.value : this.value, this.precision);
  }

  /**
   * Negate the value
   */
  negate(): Decimal {
    return new Decimal(-this.value, this.precision);
  }

  /**
   * Compare with another decimal
   */
  compare(other: string | number | Decimal): -1 | 0 | 1 {
    const otherInt = other instanceof Decimal ? other.value : decimalToInt(toDecimalString(other), this.precision);
    if (this.value < otherInt) return -1;
    if (this.value > otherInt) return 1;
    return 0;
  }

  /**
   * Check equality
   */
  equals(other: string | number | Decimal): boolean {
    return this.compare(other) === 0;
  }

  /**
   * Check if greater than
   */
  gt(other: string | number | Decimal): boolean {
    return this.compare(other) > 0;
  }

  /**
   * Check if greater than or equal
   */
  gte(other: string | number | Decimal): boolean {
    return this.compare(other) >= 0;
  }

  /**
   * Check if less than
   */
  lt(other: string | number | Decimal): boolean {
    return this.compare(other) < 0;
  }

  /**
   * Check if less than or equal
   */
  lte(other: string | number | Decimal): boolean {
    return this.compare(other) <= 0;
  }

  /**
   * Check if zero
   */
  isZero(): boolean {
    return this.value === 0n;
  }

  /**
   * Check if positive
   */
  isPositive(): boolean {
    return this.value > 0n;
  }

  /**
   * Check if negative
   */
  isNegative(): boolean {
    return this.value < 0n;
  }

  /**
   * Round to specified decimal places
   */
  round(decimalPlaces: number): Decimal {
    const scale = quantizeScale(decimalPlaces, this.precision);
    return new Decimal(divRoundHalfUp(this.value, scale) * scale, this.precision);
  }

  /**
   * Floor to specified decimal places
   */
  floor(decimalPlaces: number): Decimal {
    const scale = quantizeScale(decimalPlaces, this.precision);
    return new Decimal(divFloor(this.value, scale) * scale, this.precision);
  }

  /**
   * Ceiling to specified decimal places
   */
  ceil(decimalPlaces: number): Decimal {
    const scale = quantizeScale(decimalPlaces, this.precision);
    return new Decimal(divCeil(this.value, scale) * scale, this.precision);
  }

  /**
   * Convert to string representation
   */
  toString(): string {
    return intToDecimal(this.value, this.precision);
  }

  /**
   * Convert to number (may lose precision)
   */
  toNumber(): number {
    return parseFloat(this.toString());
  }

  /**
   * Convert to BigInt (integer representation)
   */
  toBigInt(): bigint {
    return this.value;
  }

  /**
   * Get the precision
   */
  getPrecision(): number {
    return this.precision;
  }
}

// ============================================================================
// Internal Helper Functions
// ============================================================================

/**
 * Convert decimal string to BigInt (smallest unit representation).
 *
 * Parses STRICTLY, to `isValidDecimal`'s contract. The library shipped that
 * validator from the first commit and this function did not use it, so three
 * shapes it rejects were being accepted here and read as amounts:
 *
 *   - `'0x10'` — `BigInt` accepts hex, octal and binary string literals, and
 *     the padded digits made it a valid one. `addDecimals('0x10', '0')`
 *     returned `'4503.599627370496'`: a sixteen-character string that is not
 *     a number becoming four and a half thousand coins.
 *   - `'1.2.3'` — split on the point and everything past the second part was
 *     dropped in silence, so the value read as `1.2`.
 *   - `'+1.5'`, `'.5'`, `'5.'` — accepted here, rejected by the validator.
 *     Two readings of one string is the defect, whichever one is nicer.
 *
 * Empty, whitespace, `null` and `undefined` used to return `0n`. A missing
 * amount is not an amount of zero: that reading turns a failed lookup, an
 * absent column or a dropped field into a free transfer, and it does it
 * without a line in any log. They throw now, like every other thing this
 * cannot read.
 *
 * @throws Error when `value` is not a plain decimal string.
 */
function decimalToInt(value: string, precision: number): bigint {
  if (typeof value !== 'string') {
    throw new Error(
      `Not a decimal string: ${JSON.stringify(value)} (${value === null ? 'null' : typeof value})`,
    );
  }

  const trimmed = value.trim();
  if (!isValidDecimal(trimmed)) {
    throw new Error(`Not a decimal: ${JSON.stringify(value)}`);
  }

  const isNeg = trimmed.startsWith('-');
  const magnitude = isNeg ? trimmed.slice(1) : trimmed;

  const [intPart = '0', rawFrac = ''] = magnitude.split('.');

  // Digits below the requested scale are dropped, not rounded: a scale is a
  // statement about how much of the value is representable, and inventing a
  // unit at the boundary is how a total comes out above what exists. Callers
  // that want the nearest value have `roundDecimal`.
  const fracPart =
    rawFrac.length > precision ? rawFrac.slice(0, precision) : rawFrac.padEnd(precision, '0');

  const result = BigInt(`${intPart}${fracPart}`);
  return isNeg ? -result : result;
}

/**
 * Expand a number to a plain decimal string, exponent notation included.
 *
 * `String(1e-9)` is `'1e-9'`, which is not a decimal; before the strict
 * parser above it reached `BigInt` and threw a `SyntaxError` naming a padded
 * string the caller never wrote. Every number entering this module goes
 * through here, so a small multiplier is a small multiplier rather than an
 * accident of how JavaScript prints it.
 */
function numberToDecimalString(value: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Not a finite number: ${String(value)}`);
  }

  const printed = String(Object.is(value, -0) ? 0 : value);
  const match = /^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(printed);
  if (!match) return printed;

  const [, sign = '', intPart = '0', fracPart = '', expPart = '0'] = match;
  const digits = `${intPart}${fracPart}`;
  const pointAt = intPart.length + Number(expPart);

  const magnitude =
    pointAt <= 0
      ? `0.${'0'.repeat(-pointAt)}${digits}`
      : pointAt >= digits.length
        ? `${digits}${'0'.repeat(pointAt - digits.length)}`
        : `${digits.slice(0, pointAt)}.${digits.slice(pointAt)}`;

  return `${sign === '-' ? '-' : ''}${magnitude}`;
}

/** A fluent-API operand as a decimal string; numbers keep their own notation. */
function toDecimalString(value: string | number): string {
  return typeof value === 'number' ? numberToDecimalString(value) : value;
}

/**
 * The scale that separates `decimalPlaces` from `precision`, for the three
 * quantizing helpers.
 *
 * `decimalPlaces` is clamped into `[0, precision]`. Asking for more places
 * than the value carries made `10n ** BigInt(negative)` throw a `RangeError`
 * about exponents, which is not a thing the caller did.
 */
function quantizeScale(decimalPlaces: number, precision: number): bigint {
  const places = Math.min(Math.max(Math.trunc(decimalPlaces), 0), precision);
  return BigInt(10) ** BigInt(precision - places);
}

/** Divide toward negative infinity. BigInt `/` truncates toward zero. */
function divFloor(value: bigint, scale: bigint): bigint {
  const quotient = value / scale;
  return value % scale !== 0n && value < 0n ? quotient - 1n : quotient;
}

/** Divide toward positive infinity. */
function divCeil(value: bigint, scale: bigint): bigint {
  const quotient = value / scale;
  return value % scale !== 0n && value > 0n ? quotient + 1n : quotient;
}

/** Divide to the nearest, ties away from zero. */
function divRoundHalfUp(value: bigint, scale: bigint): bigint {
  const half = scale / 2n;
  return value >= 0n ? (value + half) / scale : (value - half) / scale;
}

/**
 * Convert BigInt (smallest unit) to decimal string.
 *
 * At `precision = 0` this used to return the digits behind a decimal point:
 * `str.slice(0, -0)` is `slice(0, 0)`, because `-0 === 0`, so `123n` came
 * back as `'0.123'` — every integer-scale amount off by its own magnitude.
 * A zero scale means no fractional part at all, and no point either.
 */
function intToDecimal(value: bigint, precision: number): string {
  const isNeg = value < 0n;
  const digits = (isNeg ? -value : value).toString().padStart(precision + 1, '0');

  const magnitude =
    precision > 0
      ? `${digits.slice(0, digits.length - precision)}.${digits.slice(digits.length - precision)}`
      : digits;

  // -0 is not an amount anyone holds.
  return isNeg && value !== 0n ? `-${magnitude}` : magnitude;
}
