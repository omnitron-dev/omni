/**
 * Canonical BTC / XMR amount formatter.
 *
 * Why this exists
 * ---------------
 * Pre-consolidation the platform had ~8 independent formatters,
 * each shipping its own opinion of precision:
 *
 *   - `org-finances/formatBtc`     → BTC 8, XMR 4
 *   - `org-revenue-card`           → BTC 4, XMR 4
 *   - `orgs-overview/formatBtc`    → tiered 8 → 4 → 2 by magnitude
 *   - `shop-dashboard`             → BTC 4
 *   - `shop-categories`            → BTC 8 with trailing-zero trim
 *   - `finances/hooks`             → BTC 8, XMR 8 (already canonical
 *                                    but isolated from everyone else)
 *   - `pages/finances DEFAULT_ASSETS` → XMR 12 (wire-precision leak)
 *
 * Result: a single dashboard showed BTC 4 in the KPI tile, BTC 8
 * in the Financial Overview tile, and BTC 6 in another corner —
 * three "truths" for the same value. This module is the single
 * source of truth from now on; all call sites import from here.
 *
 * Display vs wire precision
 * -------------------------
 * Wire precision (what the backend stores) is 8 for BTC, 12 for
 * XMR — those are the on-chain atomic units (satoshi, piconero).
 * Display precision is 8 for BOTH coins by platform convention:
 *
 *   - 8 fractional digits is a satoshi-level read for BTC,
 *   - 8 fractional digits for XMR is "good enough" for human eyes
 *     and keeps the column widths symmetric. The last 4 digits of
 *     XMR's wire value are dropped from display only — never from
 *     storage, math, or wire transfers.
 *
 * The platform-wide symmetric formatting was a direct user-facing
 * request: the same coin column should align cleanly whether the
 * row holds BTC or XMR.
 *
 * If you need a *narrower* surface (a dense table, a stat-card
 * subtitle), use `{ trim: true }` to drop trailing zeros while
 * keeping the canonical precision as the cap. Don't bypass this
 * module with an ad-hoc `toFixed(N)` — that's exactly the entropy
 * we just cleaned up.
 */

/**
 * Canonical display-precision per supported coin. Use this when
 * you need the raw precision number (e.g. populating an input
 * field's `.toFixed(...)` to seed a "max balance" button). For
 * actual rendering of a value, prefer `formatCoinAmount`.
 */
export const COIN_DISPLAY_DECIMALS: Readonly<Record<string, number>> = Object.freeze(
  // Prototype-free: a plain literal answers `COIN_DISPLAY_DECIMALS['constructor']`
  // with a function, which `?? FALLBACK_DECIMALS` accepts as a precision. That
  // produced `toFixed(NaN)` — silently formatting with zero decimals instead
  // of eight, for any coin code that collides with an Object.prototype key.
  Object.assign(Object.create(null) as Record<string, number>, { btc: 8, xmr: 8 })
);

/** Default precision when the coin code isn't recognized. */
const FALLBACK_DECIMALS = 8;

export interface FormatCoinAmountOptions {
  /**
   * Append the uppercase coin symbol (`"0.00012345 BTC"`).
   * Default `true`. Disable for places where the symbol is
   * rendered separately (e.g. a chip beside the number).
   */
  withSymbol?: boolean;
  /**
   * Trim trailing zeros after the decimal point. Useful in dense
   * tables where `0 BTC` reads cleaner than `0.00000000 BTC`. The
   * precision cap (8) is still honoured — we just drop tail
   * zeros up to and including the decimal point. Default `false`.
   */
  trim?: boolean;
  /**
   * Override precision. ONLY use this for legacy back-compat
   * (e.g. a screen that genuinely needs to truncate at a non-
   * standard width). Prefer the default. Negative values clamp
   * to 0.
   */
  precision?: number;
  /**
   * Custom symbol override. Defaults to `coin.toUpperCase()`. Set
   * this if you need a non-standard label (e.g. "₿" for BTC) —
   * but be aware that mixing symbols across the platform is what
   * this module was built to prevent.
   */
  symbol?: string;
}

/**
 * Resolve the canonical display precision for a coin code.
 * Case-insensitive. Unknown codes fall back to 8.
 */
export function getCoinDecimals(coin: string): number {
  const decimals = COIN_DISPLAY_DECIMALS[coin.toLowerCase()];
  return typeof decimals === 'number' ? decimals : FALLBACK_DECIMALS;
}

/**
 * Format a decimal STRING at a fixed scale without going through a float.
 *
 * Exported because more than one surface needs it: `formatCoinAmount` for
 * coin balances, `AmountCell` for financial tables. Anything that receives a
 * decimal string from the wire and renders it should use this rather than
 * `Number(x).toFixed(n)`.
 *
 * The docblock above promises that string input "preserves full precision
 * end-to-end from the RPC wire", but the implementation used to hand the
 * string straight to `Number()` — inheriting binary floating point along with
 * its rounding surprises. `'1.005'` is fractionally BELOW 1.005 as a double,
 * so `toFixed(2)` rendered `'1.00'`: a balance displayed one cent short of
 * the one actually stored.
 *
 * Rounding here is half-up on the decimal digits themselves, carried with
 * BigInt so a carry across the whole number (`'9.999' → '10.00'`) is exact at
 * any magnitude.
 *
 * @returns the formatted string, or `null` when `raw` is not a plain decimal
 *          (exponent notation, junk) — the caller then falls back to `Number`.
 */
export function formatDecimalString(raw: string, decimals: number): string | null {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(raw.trim());
  if (!match) return null;

  const [, sign = '', intPart = '', fracPart = ''] = match;
  if (intPart === '' && fracPart === '') return null;

  const digits = `${intPart || '0'}${fracPart.slice(0, decimals).padEnd(decimals, '0')}`;
  const roundUp = (fracPart[decimals] ?? '0') >= '5';
  const scaled = BigInt(digits) + (roundUp ? 1n : 0n);

  const asString = scaled.toString().padStart(decimals + 1, '0');
  const whole = asString.slice(0, asString.length - decimals) || '0';
  const fraction = decimals > 0 ? asString.slice(asString.length - decimals) : '';
  const magnitude = decimals > 0 ? `${whole}.${fraction}` : whole;

  // -0 is not a balance anyone holds.
  const isZero = scaled === 0n;
  return `${sign === '-' && !isZero ? '-' : ''}${magnitude}`;
}

/**
 * Format a crypto amount for display.
 *
 * Input can be a string (preferred — preserves full precision
 * end-to-end from the RPC wire) or a number. Non-finite / NaN
 * inputs render as the zero-shaped placeholder so the UI never
 * shows `NaN BTC`.
 *
 * @example
 *   formatCoinAmount('0.001', 'BTC')                 // '0.00100000 BTC'
 *   formatCoinAmount('0.001', 'BTC', { trim: true }) // '0.001 BTC'
 *   formatCoinAmount(null, 'XMR')                    // '0.00000000 XMR'
 *   formatCoinAmount('1.23456789', 'BTC', { withSymbol: false }) // '1.23456789'
 */
export function formatCoinAmount(
  value: string | number | null | undefined,
  coin: string,
  options?: FormatCoinAmountOptions,
): string {
  const code = coin.toLowerCase();
  const symbol = options?.symbol ?? coin.toUpperCase();
  const withSymbol = options?.withSymbol !== false;
  const decimals = Math.max(0, options?.precision ?? getCoinDecimals(code));
  const trim = options?.trim === true;

  let formatted: string | null = null;

  if (typeof value === 'string' && value.trim().length > 0) {
    // Preferred path: format the decimal digits directly, no float involved.
    formatted = formatDecimalString(value, decimals);
  }

  if (formatted === null) {
    let n: number;
    if (typeof value === 'number') {
      n = value;
    } else if (typeof value === 'string' && value.trim().length > 0) {
      n = Number(value);
    } else {
      n = 0;
    }
    if (!Number.isFinite(n)) n = 0;
    // `-0` formats as "-0.00000000" otherwise.
    if (Object.is(n, -0)) n = 0;
    formatted = n.toFixed(decimals);
  }
  if (trim && formatted.includes('.')) {
    // Drop trailing zeros and a trailing solitary decimal point.
    formatted = formatted.replace(/\.?0+$/, '');
    if (formatted === '' || formatted === '-') formatted = '0';
  }

  return withSymbol ? `${formatted} ${symbol}` : formatted;
}

/**
 * Render a multi-coin total map (e.g. revenue across coins)
 * as a single inline string: `"0.00010000 BTC · 0.00000000 XMR"`.
 *
 * Stable ordering by lower-cased coin code so BTC always appears
 * before XMR regardless of object-property iteration quirks.
 */
export function formatCoinAmountList(
  totals: Partial<Record<string, string | number | null | undefined>>,
  options?: FormatCoinAmountOptions & { separator?: string },
): string {
  const sep = options?.separator ?? ' · ';
  return Object.keys(totals)
    .sort()
    .map((coin) => formatCoinAmount(totals[coin], coin, options))
    .join(sep);
}
