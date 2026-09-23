/**
 * How an audit row's action ended — one reading for `omnitron audit`, which
 * colours it, and the console's audit page, which showed none: its rows
 * carried `outcome=partial` as one more `key=value` among the details, so a
 * stack start in which apps did not come up read like any other.
 *
 * Imported by the console through `@omnitron-dev/omnitron/audit-outcome`, so
 * nothing here may need Node.
 */

/** `partial`: the action happened, and not all of it — a stack start where some apps did not come up. */
export type AuditOutcome = 'ok' | 'partial' | 'failed';

/** The part of an audit row its ending is read from. */
export interface OutcomeFields {
  readonly action: string;
  readonly details?: Readonly<Record<string, unknown>> | null | undefined;
}

/**
 * How a row's action ended, as far as the row says: its recorded outcome, or
 * `failed` for an action named as a failure (`node.upgrade.failed`). `null`
 * for a row that records neither — most rows, written after an action that
 * worked by a writer that records nothing else; `null` says that without
 * claiming more.
 */
export function outcomeOf(row: OutcomeFields): AuditOutcome | null {
  const recorded = row.details?.['outcome'];
  if (recorded === 'ok' || recorded === 'partial' || recorded === 'failed') return recorded;
  return row.action.endsWith('.failed') ? 'failed' : null;
}

/** What a row says of its ending beyond the word, and the `details` key it said it under. */
export interface OutcomeReason {
  readonly key: string;
  readonly text: string;
}

/**
 * Why a row ended the way it did, when it says: for `partial`, what did not
 * come up (`details.notUp`, as `stack.start` records it); for `failed`, what
 * went wrong (`details.error`, or `details.message` in the older rows that
 * named the failure in the action). `null` when the row says nothing more.
 *
 * With its key, so a reader listing the rest of `details` need not repeat it.
 */
export function outcomeReason(row: OutcomeFields): OutcomeReason | null {
  const said = (key: string, words: (text: string) => string = (text) => text): OutcomeReason | null => {
    const value = row.details?.[key];
    return typeof value === 'string' && value !== '' ? { key, text: words(value) } : null;
  };
  switch (outcomeOf(row)) {
    case 'partial':
      return said('notUp', (apps) => `not up: ${apps}`);
    case 'failed':
      return said('error') ?? said('message');
    default:
      return null;
  }
}
