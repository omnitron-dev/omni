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
  const aInt = decimalToInt(a, precision);
  // Use higher intermediate precision to avoid loss
  const multiplierInt = BigInt(Math.round(multiplier * 1e8));
  const result = (aInt * multiplierInt) / BigInt(1e8);
  return intToDecimal(result, precision);
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
  const aInt = decimalToInt(a, precision);
  // Use higher intermediate precision
  const divisorInt = BigInt(Math.round(divisor * 1e8));
  const scale = BigInt(1e8);
  const result = (aInt * scale) / divisorInt;
  return intToDecimal(result, precision);
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
  const str = typeof value === 'number' ? value.toString() : value;
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
  const int = decimalToInt(value, precision);
  const scale = BigInt(10) ** BigInt(precision - decimalPlaces);
  const rounded = ((int + scale / 2n) / scale) * scale;
  return intToDecimal(rounded, precision);
}

/**
 * Floor decimal to specified decimal places (round towards negative infinity)
 */
export function floorDecimal(value: string, decimalPlaces: number, precision: number = DEFAULT_PRECISION): string {
  const int = decimalToInt(value, precision);
  const scale = BigInt(10) ** BigInt(precision - decimalPlaces);
  const floored = (int / scale) * scale;
  return intToDecimal(floored, precision);
}

/**
 * Ceiling decimal to specified decimal places (round towards positive infinity)
 */
export function ceilDecimal(value: string, decimalPlaces: number, precision: number = DEFAULT_PRECISION): string {
  const int = decimalToInt(value, precision);
  const scale = BigInt(10) ** BigInt(precision - decimalPlaces);
  const ceiled = ((int + scale - 1n) / scale) * scale;
  return intToDecimal(ceiled, precision);
}

// ============================================================================
// Cryptocurrency Conversion Helpers
// ============================================================================

/** BTC: 8 decimal places (1 satoshi = 10^-8 BTC) */
const BTC_DECIMALS = 8;
/** XMR: 8 decimal places for display/RPC (atomic unit = piconero, but standard display uses 8) */
const XMR_DECIMALS = 8;

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
 * Convert atomic XMR units to XMR string (8 decimal places)
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
    const str = typeof value === 'number' ? value.toString() : value;
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
    const otherInt = other instanceof Decimal ? other.value : decimalToInt(String(other), this.precision);
    return new Decimal(this.value + otherInt, this.precision);
  }

  /**
   * Subtract another decimal
   */
  subtract(other: string | number | Decimal): Decimal {
    const otherInt = other instanceof Decimal ? other.value : decimalToInt(String(other), this.precision);
    return new Decimal(this.value - otherInt, this.precision);
  }

  /**
   * Multiply by a number
   */
  multiply(multiplier: number): Decimal {
    const multiplierInt = BigInt(Math.round(multiplier * 1e8));
    const result = (this.value * multiplierInt) / BigInt(1e8);
    return new Decimal(result, this.precision);
  }

  /**
   * Multiply by another decimal
   */
  multiplyBy(other: string | number | Decimal): Decimal {
    const otherInt = other instanceof Decimal ? other.value : decimalToInt(String(other), this.precision);
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
    const divisorInt = BigInt(Math.round(divisor * 1e8));
    const result = (this.value * BigInt(1e8)) / divisorInt;
    return new Decimal(result, this.precision);
  }

  /**
   * Divide by another decimal
   */
  divideBy(other: string | number | Decimal): Decimal {
    const otherInt = other instanceof Decimal ? other.value : decimalToInt(String(other), this.precision);
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
    const otherInt = other instanceof Decimal ? other.value : decimalToInt(String(other), this.precision);
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
    const scale = BigInt(10) ** BigInt(this.precision - decimalPlaces);
    const rounded = ((this.value + scale / 2n) / scale) * scale;
    return new Decimal(rounded, this.precision);
  }

  /**
   * Floor to specified decimal places
   */
  floor(decimalPlaces: number): Decimal {
    const scale = BigInt(10) ** BigInt(this.precision - decimalPlaces);
    const floored = (this.value / scale) * scale;
    return new Decimal(floored, this.precision);
  }

  /**
   * Ceiling to specified decimal places
   */
  ceil(decimalPlaces: number): Decimal {
    const scale = BigInt(10) ** BigInt(this.precision - decimalPlaces);
    const ceiled = ((this.value + scale - 1n) / scale) * scale;
    return new Decimal(ceiled, this.precision);
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
 * Convert decimal string to BigInt (smallest unit representation)
 */
function decimalToInt(value: string, precision: number): bigint {
  // Handle empty string
  if (!value || value.trim() === '') {
    return 0n;
  }

  // Remove leading/trailing whitespace
  value = value.trim();

  // Handle negative numbers
  const isNeg = value.startsWith('-');
  if (isNeg) {
    value = value.slice(1);
  }

  // Split by decimal point
  const parts = value.split('.');
  const intPart = parts[0] || '0';
  let fracPart = parts[1] || '';

  // Pad or truncate fractional part to precision
  if (fracPart.length > precision) {
    fracPart = fracPart.slice(0, precision);
  } else {
    fracPart = fracPart.padEnd(precision, '0');
  }

  // Combine and convert to BigInt
  const combined = intPart + fracPart;
  let result = BigInt(combined);

  if (isNeg) {
    result = -result;
  }

  return result;
}

/**
 * Convert BigInt (smallest unit) to decimal string
 */
function intToDecimal(value: bigint, precision: number): string {
  // Handle negative numbers
  const isNeg = value < 0n;
  if (isNeg) {
    value = -value;
  }

  // Convert to string and pad with leading zeros if needed
  let str = value.toString();
  str = str.padStart(precision + 1, '0');

  // Insert decimal point
  const intPart = str.slice(0, -precision) || '0';
  const fracPart = str.slice(-precision);

  const result = `${intPart}.${fracPart}`;

  return isNeg ? `-${result}` : result;
}
