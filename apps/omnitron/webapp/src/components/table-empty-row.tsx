/**
 * The row a table shows when it has none.
 *
 * The console's tables are hand-rolled rather than `AdminDataTable`, and each
 * carried its own centred `<Typography>` saying some variant of "nothing
 * here". That phrasing is a claim, and it was wrong on the traces page for as
 * long as that page existed: both of its queries failed against the database
 * schema, it had never returned a row, and it said "No traces collected yet"
 * — which reads as a healthy answer and is why nobody looked.
 *
 * This makes the two states say different things. Same distinction prism's
 * `AdminDataTable` now draws, in the shape the console's tables have.
 */

import TableCell from '@mui/material/TableCell';
import TableRow from '@mui/material/TableRow';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

export interface TableEmptyRowProps {
  /** Columns to span. */
  colSpan: number;
  /** What to say when the table is legitimately empty. */
  message: string;
  /**
   * Why the data could not be loaded, when that is the reason for the
   * emptiness. An empty string counts as no error, so a caller threading
   * `error ?? ''` does not flip the table into a failure state with nothing
   * to say.
   */
  error?: string | null;
}

export function TableEmptyRow({ colSpan, message, error }: TableEmptyRowProps) {
  const failed = Boolean(error);

  return (
    <TableRow>
      <TableCell colSpan={colSpan} sx={{ textAlign: 'center', py: 6, borderBottom: 'none' }}>
        <Stack spacing={0.5} sx={{ alignItems: 'center' }}>
          <Typography
            variant="body2"
            // Not `text.disabled` for a failure: a reason the reader needs
            // must not be the palette's quietest text.
            sx={{ color: failed ? 'text.secondary' : 'text.disabled' }}
          >
            {failed ? 'Could not load this data' : message}
          </Typography>
          {failed && (
            <Typography variant="caption" sx={{ color: 'text.disabled', maxWidth: 460 }}>
              {error}
            </Typography>
          )}
        </Stack>
      </TableCell>
    </TableRow>
  );
}
