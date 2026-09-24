/**
 * A deadline, said as the time left — and coloured by how little.
 *
 * The downstream platform keeps a deadline in twenty-one tables: a cart's
 * quote, an escrow's auto-finalisation, a dispute's response window, a pickup
 * code… and a missed one costs money. A date says when; the chip says how
 * long, in the reader's language, and turns warning, then error, as it nears.
 * The absolute moment stays one hover away, in a `<time>` element.
 *
 * @module components/deadline-chip
 */

'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { SxProps, Theme } from '@mui/material/styles';
import { Label, type LabelColor, type LabelVariant } from '../label/index.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type DeadlineUrgency = 'overdue' | 'urgent' | 'soon' | 'later';

export interface DeadlineChipProps {
  /** When it is due */
  deadline: Date | string | number;
  /** BCP 47 locale for the time left and the exact date — the application's current language */
  locale?: string | undefined;
  /** Said instead of the time since, once the deadline has passed (e.g. «просрочено») */
  overdueLabel?: string | undefined;
  /** Less time than this is urgent. Default: one hour. */
  urgentWithinMs?: number | undefined;
  /** Less time than this is soon. Default: one day. */
  soonWithinMs?: number | undefined;
  /** The clock — for tests */
  now?: (() => number) | undefined;
  sx?: SxProps<Theme> | undefined;
}

/** How near a deadline is, from the time left. */
export function deadlineUrgency(leftMs: number, urgentWithinMs = HOUR, soonWithinMs = DAY): DeadlineUrgency {
  if (leftMs <= 0) return 'overdue';
  if (leftMs < urgentWithinMs) return 'urgent';
  if (leftMs < soonWithinMs) return 'soon';
  return 'later';
}

/** The time left (or since, when negative) in the locale's own short words: «через 2 ч», «in 2 hr». */
export function relativeTimeLeft(leftMs: number, locale?: string): string {
  const words = new Intl.RelativeTimeFormat(locale, { numeric: 'always', style: 'short' });
  const size = Math.abs(leftMs);
  const sign = leftMs < 0 ? -1 : 1;
  if (size < HOUR) return words.format(sign * Math.max(1, Math.round(size / MINUTE)), 'minute');
  if (size < 2 * DAY) return words.format(sign * Math.round(size / HOUR), 'hour');
  return words.format(sign * Math.round(size / DAY), 'day');
}

const LOOK: Record<DeadlineUrgency, { color: LabelColor; variant: LabelVariant }> = {
  overdue: { color: 'error', variant: 'filled' },
  urgent: { color: 'error', variant: 'soft' },
  soon: { color: 'warning', variant: 'soft' },
  later: { color: 'default', variant: 'soft' },
};

/**
 * @example
 * ```tsx
 * <DeadlineChip deadline={dispute.responseDeadline} locale={i18n.language} overdueLabel={t('deadline.overdue')} />
 * ```
 */
export function DeadlineChip({
  deadline,
  locale,
  overdueLabel,
  urgentWithinMs,
  soonWithinMs,
  now = Date.now,
  sx,
}: DeadlineChipProps): ReactNode {
  const [at, setAt] = useState(now);
  useEffect(() => {
    const tick = setInterval(() => setAt(now()), 30_000);
    return () => clearInterval(tick);
  }, [now]);

  const due = new Date(deadline).getTime();
  if (Number.isNaN(due)) return null;

  const left = due - at;
  const urgency = deadlineUrgency(left, urgentWithinMs, soonWithinMs);
  const look = LOOK[urgency];
  const text = urgency === 'overdue' && overdueLabel ? overdueLabel : relativeTimeLeft(left, locale);
  const exact = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(due);

  return (
    <Label
      color={look.color}
      variant={look.variant}
      data-urgency={urgency}
      sx={[{ fontVariantNumeric: 'tabular-nums' }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      <time dateTime={new Date(due).toISOString()} title={exact}>
        {text}
      </time>
    </Label>
  );
}
