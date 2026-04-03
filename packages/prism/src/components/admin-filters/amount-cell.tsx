'use client';

/**
 * Amount Cell Component
 *
 * Formatted amount display for financial tables with monospace font,
 * optional sign coloring, and currency display.
 *
 * @module @omnitron/prism/components/admin-filters
 */

import type { ReactNode } from 'react';
import { useMemo } from 'react';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

// =============================================================================
// TYPES
// =============================================================================

export interface AmountCellProps {
  /** Amount as string (to preserve precision for crypto values) */
  amount: string;
  /** Currency code (e.g. "BTC", "USD", "XMR") */
  currency?: string;
  /** Number of decimal places */
  decimals?: number;
  /** Show +/- sign prefix */
  showSign?: boolean;
  /** Color positive green / negative red */
  color?: boolean;
  /** Additional styles */
  sx?: SxProps<Theme>;
}

// =============================================================================
// HELPERS
// =============================================================================

function formatAmount(amount: string, decimals?: number): string {
  const num = parseFloat(amount);
  if (Number.isNaN(num)) return amount;

  const fixed = decimals !== undefined ? num.toFixed(decimals) : amount;
  const [intPart, decPart] = fixed.split('.');
  const absInt = intPart.replace('-', '');

  // Add thousands separators
  const formatted = absInt.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  const prefix = num < 0 ? '-' : '';
  return decPart !== undefined ? `${prefix}${formatted}.${decPart}` : `${prefix}${formatted}`;
}

// =============================================================================
// COMPONENT
// =============================================================================

/**
 * AmountCell - Formatted amount display for financial data.
 *
 * Uses monospace font for alignment. Supports sign display, color coding
 * (green for positive, red for negative), and currency suffixes.
 *
 * @example
 * ```tsx
 * <AmountCell amount="1234.56" currency="BTC" decimals={8} />
 * <AmountCell amount="-500.00" currency="USD" showSign color />
 * <AmountCell amount="0.00045123" currency="XMR" decimals={12} />
 * ```
 */
export function AmountCell({
  amount,
  currency,
  decimals,
  showSign = false,
  color = false,
  sx,
}: AmountCellProps): ReactNode {
  const num = parseFloat(amount);
  const isNegative = num < 0;
  const isPositive = num > 0;

  const formatted = useMemo(() => formatAmount(amount, decimals), [amount, decimals]);

  const signPrefix = useMemo(() => {
    if (!showSign) return '';
    if (isPositive) return '+';
    return '';
  }, [showSign, isPositive]);

  const textColor = useMemo(() => {
    if (!color) return undefined;
    if (isPositive) return 'success.main';
    if (isNegative) return 'error.main';
    return 'text.secondary';
  }, [color, isPositive, isNegative]);

  return (
    <Typography
      variant="body2"
      color={textColor}
      sx={{
        fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", "Consolas", monospace',
        fontVariantNumeric: 'tabular-nums',
        fontSize: '0.8rem',
        fontWeight: 500,
        whiteSpace: 'nowrap',
        textAlign: 'right',
        ...sx,
      }}
    >
      {signPrefix}
      {formatted}
      {currency && (
        <Typography
          component="span"
          variant="caption"
          color="text.disabled"
          sx={{
            ml: 0.5,
            fontFamily: 'inherit',
            fontSize: '0.7rem',
            fontWeight: 400,
          }}
        >
          {currency}
        </Typography>
      )}
    </Typography>
  );
}
