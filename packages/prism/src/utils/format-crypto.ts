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
 * Which way a dropped digit goes
 * ------------------------------
 * Those four dropped XMR digits are the reason this module has a
 * rounding DIRECTION and not just a scale. Display rounding used
 * to be half-up, so a balance of
 *
 *     1.586170199999 XMR   (what the account holds)
 *
 * rendered as `1.58617020 XMR` — a tenth of a piconero MORE than
 * exists. A person who reads that number and types it back into a
 * withdrawal is refused for insufficient funds, by a figure the
 * platform itself put on their screen. The same arithmetic seeds
 * the "max balance" shortcut, so the refusal arrives from a button
 * whose entire purpose is to be correct.
 *
 * So the rule for anything rendered as money is: **the displayed
 * magnitude is never larger than the real one.** Quantization for
 * display truncates toward zero (`'down'`), at any precision, in
 * either sign. That is not a matter of taste at eight decimals
 * versus twelve — it holds whatever the scale, which is why it is
 * a separate decision from the 8-vs-12 convention above.
 *
 * Half-up remains available and remains the default for the
 * ARITHMETIC primitives (`toScaledInteger`, `sumDecimalStrings`,
 * `subtractDecimalStrings`), where the scale is the value's own
 * and the last digit is a genuine rounding rather than a
 * truncation of digits that are really there. Arithmetic on money
 * belongs at `getCoinWireDecimals(coin)`, not at display scale;
 * quantize once, at the end, downward.
 *
 * The other direction is a lie too
 * --------------------------------
 * Truncating `0.000000004916 XMR` to eight decimals gives
 * `0.00000000` — a balance that exists, shown as nothing at all.
 * `formatCoinAmount` renders that as `< 0.00000001 XMR` instead
 * (`> -0.00000001` below zero). A threshold marker is honest about
 * both the amount and the limit of the column; a flat zero is not.
 * Pass `markDust: false` where a bare numeral is required.
 *
 * If you need a *narrower* surface (a dense table, a stat-card
 * subtitle), use `{ trim: true }` to drop trailing zeros while
 * keeping the canonical precision as the cap. Don't bypass this
 * module with an ad-hoc `toFixed(N)` — that's exactly the entropy
 * we just cleaned up, and `toFixed` rounds the wrong way for money
 * on top of rounding a double.
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

/**
 * Atomic-unit precision per coin — what the backend actually stores.
 *
 * This is NOT a display precision and must never be used as one; the
 * platform shows both coins at eight digits on purpose (see the module
 * docblock). It is the scale to do ARITHMETIC at: totalling balances,
 * subtracting a lock from a total, comparing an entered amount against
 * what is available. Doing that at display scale quantizes four XMR
 * digits away before the sum, and each quantization is a chance to
 * report a figure the ledger does not agree with.
 *
 * The authority is payments's `coins.precision` column (`BTC` 8, `XMR` 12);
 * main keeps its own copy in `billing.service.ts` as `CRYPTO_PRECISION`.
 * This is the browser's copy, because a synchronous formatter cannot
 * query a table. Three copies of one fact: when a coin is added, all
 * three change, and a mismatch here shows up as arithmetic that silently
 * drops the coin's last digits.
 */
export const COIN_WIRE_DECIMALS: Readonly<Record<string, number>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, number>, { btc: 8, xmr: 12 })
);

/** Default precision when the coin code isn't recognized. */
const FALLBACK_DECIMALS = 8;

/**
 * Wire-scale fallback for an unrecognized coin.
 *
 * Deliberately the WIDEST scale this module knows rather than the
 * narrowest. An unknown coin's digits survive arithmetic done at a scale
 * too wide; at a scale too narrow they are gone before the first
 * operation, and nothing downstream can tell. The display fallback goes
 * the other way for the same reason it truncates: too few digits shown is
 * a smaller error than digits invented.
 */
const FALLBACK_WIRE_DECIMALS = 12;

/**
 * Which way a value that does not fit the requested scale is quantized.
 *
 *   `'down'`     toward zero. The displayed magnitude is never larger
 *                than the real one — the rule for money on a screen.
 *   `'half-up'`  to the nearest, ties away from zero. The rule for
 *                arithmetic, where the scale is the value's own.
 */
export type DecimalRounding = 'down' | 'half-up';

/** A plain decimal: optional sign, digits, optional fraction. No exponents. */
const DECIMAL = /^([+-]?)(\d*)(?:\.(\d*))?$/;

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
  /**
   * Which way to quantize digits that do not fit `precision`.
   * Default `'down'` — a rendered amount is never larger than the
   * amount that exists. Pass `'half-up'` only where the figure is
   * not a quantity anyone holds (a rate, an average, a chart axis).
   */
  rounding?: DecimalRounding;
  /**
   * Render a non-zero amount that vanishes at this precision as
   * `< 0.00000001` rather than `0.00000000`. Default `true`.
   * Disable where the output has to be a bare numeral.
   */
  markDust?: boolean;
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
 * Resolve the ATOMIC-UNIT precision for a coin code — the scale the value
 * arrived at and the scale to compute at. Case-insensitive.
 *
 * `getCoinDecimals` is for rendering; this is for `sumDecimalStrings`,
 * `subtractDecimalStrings`, and any comparison between an amount a person
 * entered and an amount the ledger holds.
 */
export function getCoinWireDecimals(coin: string): number {
  const decimals = COIN_WIRE_DECIMALS[coin.toLowerCase()];
  return typeof decimals === 'number' ? decimals : FALLBACK_WIRE_DECIMALS;
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
 * This is the RENDERING half of the pair, so it quantizes DOWN by default:
 * the string it returns never stands for more than the string it was given.
 * Its arithmetic counterpart `toScaledInteger` defaults to `'half-up'`;
 * the two differ on purpose and the module docblock says why.
 *
 * Unlike `formatCoinAmount` it always returns a plain parseable decimal —
 * no threshold marker, no symbol — because its callers feed the result back
 * into `Number()`.
 *
 * @returns the formatted string, or `null` when `raw` is not a plain decimal
 *          (exponent notation, junk) — the caller then falls back to `Number`.
 */
export function formatDecimalString(
  raw: string,
  decimals: number,
  rounding: DecimalRounding = 'down'
): string | null {
  const scaled = toScaledInteger(raw, decimals, rounding);
  return scaled === null ? null : fromScaledInteger(scaled, decimals);
}

/**
 * A decimal string as an exact integer at `decimals` scale.
 *
 * `'1.005'` at scale 2 is `101n` under the default half-up — which is the
 * whole point: as a double the same literal sits fractionally BELOW 1.005,
 * so any arithmetic that starts with `Number('1.005')` has already lost
 * before it begins.
 *
 * The default is `'half-up'` because this is the arithmetic primitive:
 * callers pass the value's own scale, where the last digit is a rounding
 * and not a truncation. Rendering goes through `formatDecimalString`, which
 * defaults to `'down'` — see the module docblock.
 *
 * @returns null when `raw` is not a plain decimal (exponent notation, junk).
 */
export function toScaledInteger(
  raw: string,
  decimals: number,
  rounding: DecimalRounding = 'half-up'
): bigint | null {
  const match = DECIMAL.exec(raw.trim());
  if (!match) return null;

  const [, sign = '', intPart = '', fracPart = ''] = match;
  if (intPart === '' && fracPart === '') return null;

  const digits = `${intPart || '0'}${fracPart.slice(0, decimals).padEnd(decimals, '0')}`;
  const roundUp = rounding === 'half-up' && (fracPart[decimals] ?? '0') >= '5';
  const magnitude = BigInt(digits) + (roundUp ? 1n : 0n);

  return sign === '-' ? -magnitude : magnitude;
}

/** Render a scaled integer back as a decimal string. Inverse of `toScaledInteger`. */
export function fromScaledInteger(scaled: bigint, decimals: number): string {
  const negative = scaled < 0n;
  const asString = (negative ? -scaled : scaled).toString().padStart(decimals + 1, '0');
  const whole = asString.slice(0, asString.length - decimals) || '0';
  const fraction = decimals > 0 ? asString.slice(asString.length - decimals) : '';
  const magnitude = decimals > 0 ? `${whole}.${fraction}` : whole;

  // -0 is not a balance anyone holds.
  return `${negative && scaled !== 0n ? '-' : ''}${magnitude}`;
}

/**
 * Whether `raw` reads as a plain decimal that is not zero.
 *
 * Used to tell "this is nothing" from "this is less than the column can
 * show". Exponent notation reads as neither — this module refuses it
 * everywhere, so a value it cannot parse is not claimed to be dust either.
 */
function isNonZeroDecimal(raw: string): boolean {
  const match = DECIMAL.exec(raw.trim());
  if (!match) return false;

  const [, , intPart = '', fracPart = ''] = match;
  if (intPart === '' && fracPart === '') return false;

  return /[1-9]/.test(intPart) || /[1-9]/.test(fracPart);
}

/**
 * Add decimal strings exactly, returning a decimal string.
 *
 * For totalling amounts that arrived from the wire as strings. Accumulating
 * them with `parseFloat` is the same mistake as formatting with it, one step
 * earlier and harder to see: `0.1 + 0.2 + 0.3` is `0.6000000000000001`, and
 * while a formatter capped at eight decimals rounds that back to `0.60000000`,
 * anything that shows the raw total — a tooltip, a CSV export, a value posted
 * back to the server — shows the artefact.
 *
 * Values that are not plain decimals are skipped rather than poisoning the
 * total with `NaN`; `null` and `undefined` count as absent, not as zero-ish
 * junk. Numbers are accepted for callers mid-migration, and go through their
 * decimal representation rather than their binary one.
 *
 * @param decimals scale to accumulate at — use the coin's WIRE precision
 *        (`getCoinWireDecimals`). Accumulating at display scale quantizes
 *        each value before it is added, so the total is a sum of roundings;
 *        `getCoinDecimals` is for the one quantization at the end.
 * @param options.rounding how each value is quantized to `decimals`. Default
 *        `'half-up'`; at wire scale nothing is dropped and it does not
 *        arise. Pass `'down'` if you must accumulate at display scale and
 *        the total is money — a sum of half-ups can exceed what exists.
 */
export function sumDecimalStrings(
  values: Iterable<string | number | null | undefined>,
  decimals: number,
  options?: { rounding?: DecimalRounding }
): string {
  const rounding = options?.rounding ?? 'half-up';
  let total = 0n;

  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const scaled = toScaledInteger(
      typeof value === 'number' ? String(value) : value,
      decimals,
      rounding
    );
    if (scaled !== null) total += scaled;
  }

  return fromScaledInteger(total, decimals);
}

/**
 * Subtract decimal strings exactly, returning a decimal string.
 *
 * The companion to `sumDecimalStrings`, and the one a wallet needs more
 * often: available balance is total minus locked, and computing it with
 * `parseFloat` produces `0.19999999999999998` from `0.30000000 - 0.10000000`.
 * A formatter capped at the coin's precision rounds that back, but the raw
 * value does not always reach a formatter — a tooltip, a CSV column, a
 * "max" button that fills an amount field, or a value posted back to the
 * server all show it as it is. Small amounts are worse than wrong: they
 * become exponential notation, and `1.0999999999999999e-7` is not a number
 * any balance field will accept.
 *
 * Unparseable inputs are treated as absent — `null` when the minuend cannot
 * be read, since a difference from an unknown quantity is unknown, and
 * subtracting nothing when a subtrahend cannot be read.
 *
 * @param decimals scale to compute at — `getCoinWireDecimals(coin)`. At
 *        display scale the minuend and the subtrahends are each quantized
 *        first, and an available balance assembled from two roundings can
 *        come out above the amount the ledger will actually release.
 * @param clampAtZero return '0' rather than a negative result. On for the
 *        available-balance case, where a negative would be a display artefact
 *        of two readings taken a moment apart, not a debt.
 * @param rounding how each operand is quantized to `decimals`. Default
 *        `'half-up'`, matching `toScaledInteger`.
 */
export function subtractDecimalStrings(
  minuend: string | number | null | undefined,
  subtrahends: Iterable<string | number | null | undefined>,
  decimals: number,
  options?: { clampAtZero?: boolean; rounding?: DecimalRounding }
): string | null {
  if (minuend === null || minuend === undefined || minuend === '') return null;

  const rounding = options?.rounding ?? 'half-up';
  let total = toScaledInteger(
    typeof minuend === 'number' ? String(minuend) : minuend,
    decimals,
    rounding
  );
  if (total === null) return null;

  for (const value of subtrahends) {
    if (value === null || value === undefined || value === '') continue;
    const scaled = toScaledInteger(
      typeof value === 'number' ? String(value) : value,
      decimals,
      rounding
    );
    if (scaled !== null) total -= scaled;
  }

  if (options?.clampAtZero && total < 0n) total = 0n;
  return fromScaledInteger(total, decimals);
}

/**
 * Format a crypto amount for display.
 *
 * Input can be a string (preferred — preserves full precision
 * end-to-end from the RPC wire) or a number. Non-finite / NaN
 * inputs render as the zero-shaped placeholder so the UI never
 * shows `NaN BTC`.
 *
 * Digits below the coin's display precision are dropped, not rounded up:
 * the string returned never stands for more coin than the argument did.
 * An amount that is real but smaller than the last displayed digit renders
 * as `< 0.00000001` rather than as a flat zero.
 *
 * @example
 *   formatCoinAmount('0.001', 'BTC')                 // '0.00100000 BTC'
 *   formatCoinAmount('0.001', 'BTC', { trim: true }) // '0.001 BTC'
 *   formatCoinAmount(null, 'XMR')                    // '0.00000000 XMR'
 *   formatCoinAmount('1.23456789', 'BTC', { withSymbol: false }) // '1.23456789'
 *   formatCoinAmount('1.586170199999', 'XMR')        // '1.58617019 XMR'
 *   formatCoinAmount('0.000000004916', 'XMR')        // '< 0.00000001 XMR'
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
  const rounding = options?.rounding ?? 'down';
  const markDust = options?.markDust !== false;

  // A number goes through its DECIMAL representation, not its binary one —
  // the same choice `sumDecimalStrings` makes. `String(1.586170199999)` is
  // the shortest round-tripping decimal for that double; handing the double
  // itself to `toFixed` reintroduces exactly the rounding this module
  // exists to avoid.
  const raw =
    typeof value === 'string'
      ? value.trim()
      : typeof value === 'number' && Number.isFinite(value)
        ? String(Object.is(value, -0) ? 0 : value)
        : '';

  let formatted = raw === '' ? null : formatDecimalString(raw, decimals, rounding);
  const exact = formatted !== null;

  if (formatted === null) {
    // Not a plain decimal: exponent notation, or junk. The float path stays
    // for those, because there is nothing better to do with them.
    let n = typeof value === 'number' ? value : Number(raw);
    if (!Number.isFinite(n)) n = 0;
    // `-0` formats as "-0.00000000" otherwise.
    if (Object.is(n, -0)) n = 0;
    formatted = n.toFixed(decimals);
  }

  // Real, and smaller than this column can show. A flat zero here is the
  // mirror of rounding up: it reports an amount the holder does not have.
  if (markDust && exact && !/[1-9]/.test(formatted) && isNonZeroDecimal(raw)) {
    const epsilon = fromScaledInteger(1n, decimals);
    const below = raw.startsWith('-');
    return withSymbol
      ? `${below ? '>' : '<'} ${below ? '-' : ''}${epsilon} ${symbol}`
      : `${below ? '>' : '<'} ${below ? '-' : ''}${epsilon}`;
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
