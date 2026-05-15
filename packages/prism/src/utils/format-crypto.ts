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
export const COIN_DISPLAY_DECIMALS: Readonly<Record<string, number>> = Object.freeze({
  btc: 8,
  xmr: 8,
});

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
  return COIN_DISPLAY_DECIMALS[coin.toLowerCase()] ?? FALLBACK_DECIMALS;
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

  let n: number;
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string' && value.trim().length > 0) {
    n = Number(value);
  } else {
    n = 0;
  }
  if (!Number.isFinite(n)) n = 0;

  let formatted = n.toFixed(decimals);
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
