import { Fragment, useId, useRef, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
  Stack,
  TableCell,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useCopyToClipboard } from '@omnitron-dev/prism/core';
import { ChevronRightIcon, CopyIcon, CheckIcon } from '@omnitron-dev/prism/icons';
import { outcomeOf, outcomeReason, type AuditOutcome } from '@omnitron-dev/omnitron/audit-outcome';
import type { IOmnitronAuditService } from '@omnitron-dev/omnitron/dto/services';
import { EventFields } from 'src/components/event-fields';
import { useAuthStore } from 'src/auth/store';
import { actorWords } from 'src/utils/audit-actor';

type AuditRow = Awaited<ReturnType<IOmnitronAuditService['list']>>[number];

const MONO = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'SF Mono', monospace";
const OUTCOME_TONE: Record<AuditOutcome, 'success' | 'warning' | 'error'> = {
  ok: 'success',
  partial: 'warning',
  failed: 'error',
};

function timestamp(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { date: 'Invalid time', time: '', exact: value };
  const part = (n: number, width = 2) => String(n).padStart(width, '0');
  return {
    date: `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}`,
    time: `${part(date.getHours())}:${part(date.getMinutes())}:${part(date.getSeconds())}.${part(date.getMilliseconds(), 3)}`,
    exact: date.toISOString(),
  };
}

function Actor({ row }: { row: AuditRow }) {
  const me = useAuthStore((st) => st.user);
  const words = actorWords(row.actorId, row.actorType);
  const label = words.kind === 'user' && row.actorId === me?.id ? `${me.username} (you)` : words.text;
  return (
    <Tooltip title={words.title} arrow>
      <Chip
        size="small"
        variant="outlined"
        label={label}
        data-actor-kind={words.kind}
        sx={{
          height: 24,
          maxWidth: '100%',
          fontSize: 11,
          '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' },
        }}
      />
    </Tooltip>
  );
}

export function AuditEntryRow({ row }: { row: AuditRow }) {
  const [expanded, setExpanded] = useState(false);
  const [raw, setRaw] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const id = useId();
  const clipboard = useCopyToClipboard();
  const time = timestamp(row.createdAt);
  const outcome = outcomeOf(row);
  const reason = outcomeReason(row);
  const actor = actorWords(row.actorId, row.actorType);
  const close = () => {
    setExpanded(false);
    toggle.current?.focus();
  };
  return (
    <Fragment>
      <TableRow
        hover
        sx={{
          verticalAlign: 'top',
          bgcolor: (theme) => (expanded ? alpha(theme.palette.primary.main, 0.045) : undefined),
        }}
      >
        <TableCell sx={{ px: 0.5, width: 40 }}>
          <IconButton
            ref={toggle}
            size="small"
            aria-label={`Details for ${row.action} at ${time.exact}`}
            aria-expanded={expanded}
            aria-controls={expanded ? id : undefined}
            onClick={() => setExpanded((value) => !value)}
          >
            <ChevronRightIcon sx={{ fontSize: 18, transform: expanded ? 'rotate(90deg)' : undefined }} />
          </IconButton>
        </TableCell>
        <TableCell
          sx={{ display: { xs: 'none', sm: 'table-cell' }, whiteSpace: 'nowrap', fontFamily: MONO, fontSize: 11 }}
        >
          <Tooltip title={time.exact}>
            <Box component="time" dateTime={row.createdAt}>
              <Box>{time.date}</Box>
              <Box sx={{ color: 'text.secondary' }}>{time.time}</Box>
            </Box>
          </Tooltip>
        </TableCell>
        <TableCell sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          <Stack direction="row" sx={{ gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="body2" sx={{ fontFamily: MONO, fontWeight: 600, overflowWrap: 'anywhere' }}>
              {row.action}
            </Typography>
            {outcome && (
              <Chip
                size="small"
                variant="outlined"
                color={OUTCOME_TONE[outcome]}
                label={outcome}
                sx={{ height: 20, fontSize: 10 }}
              />
            )}
            {!outcome && row.action.endsWith('.requested') && (
              <Chip size="small" variant="outlined" label="Requested" sx={{ height: 20, fontSize: 10 }} />
            )}
          </Stack>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', fontFamily: MONO, overflowWrap: 'anywhere' }}
          >
            {row.resourceType}
            {row.resourceId ? ` · ${row.resourceId}` : ''}
          </Typography>
          {reason && (
            <Typography
              variant="caption"
              sx={{
                display: 'block',
                color: outcome ? `${OUTCOME_TONE[outcome]}.main` : 'text.secondary',
                overflowWrap: 'anywhere',
              }}
            >
              {reason.text}
            </Typography>
          )}
          <Stack
            direction="row"
            sx={{ display: { xs: 'flex', md: 'none' }, gap: 0.75, flexWrap: 'wrap', alignItems: 'center', mt: 0.5 }}
          >
            <Typography
              component="time"
              dateTime={row.createdAt}
              variant="caption"
              title={time.exact}
              sx={{ display: { xs: 'inline', sm: 'none' }, fontFamily: MONO, color: 'text.secondary' }}
            >
              {time.date} {time.time}
            </Typography>
            <Actor row={row} />
          </Stack>
        </TableCell>
        <TableCell sx={{ display: { xs: 'none', md: 'table-cell' }, minWidth: 0 }}>
          <Actor row={row} />
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={4} sx={{ p: 0 }}>
            <Collapse in timeout={0}>
              <Box
                id={id}
                role="region"
                aria-label={`Audit details: ${row.action}`}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    close();
                  }
                }}
                sx={{
                  px: { xs: 1.5, sm: 5 },
                  py: 1.5,
                  bgcolor: (theme) => alpha(theme.palette.primary.main, 0.045),
                  minWidth: 0,
                }}
              >
                <EventFields
                  values={[
                    ['Recorded at (UTC)', time.exact],
                    ['Event ID', row.id],
                    ['Action', row.action],
                    ['Resource type', row.resourceType],
                    ['Resource ID', row.resourceId ?? 'Not recorded'],
                    ['Actor type', row.actorType],
                    ['Actor ID', row.actorId ?? 'Not recorded'],
                    ['Actor context', actor.title],
                    ['Source IP', row.ipAddress ?? 'Not recorded'],
                    [
                      'Outcome',
                      outcome ??
                        (row.action.endsWith('.requested')
                          ? 'Requested; completion is not recorded by this event'
                          : 'Not recorded'),
                    ],
                  ]}
                />
                {Object.keys(row.details ?? {}).length > 0 && (
                  <Box sx={{ mt: 1.25, pt: 1.25, borderTop: '1px solid', borderColor: 'divider' }}>
                    <EventFields
                      values={Object.entries(row.details ?? {}).filter(
                        ([key, value]) => !(key === 'outcome' && value === outcome)
                      )}
                    />
                  </Box>
                )}
                <Stack direction="row" sx={{ gap: 1, mt: 1, flexWrap: 'wrap' }}>
                  <Button
                    size="small"
                    color="inherit"
                    onClick={() => setRaw((value) => !value)}
                    aria-expanded={raw}
                    aria-controls={raw ? `${id}-raw` : undefined}
                    startIcon={<ChevronRightIcon sx={{ transform: raw ? 'rotate(90deg)' : undefined }} />}
                  >
                    Raw event
                  </Button>
                  <Button
                    size="small"
                    onClick={() => void clipboard.copy(JSON.stringify(row, null, 2))}
                    startIcon={clipboard.state === 'success' ? <CheckIcon /> : <CopyIcon />}
                  >
                    {clipboard.state === 'success'
                      ? 'Copied'
                      : clipboard.state === 'error'
                        ? 'Retry copy JSON'
                        : 'Copy JSON'}
                  </Button>
                </Stack>
                {clipboard.state === 'error' && (
                  <Typography role="status" variant="caption" color="error">
                    Clipboard unavailable. Open Raw event to select the text.
                  </Typography>
                )}
                {raw && (
                  <Box
                    component="pre"
                    id={`${id}-raw`}
                    tabIndex={0}
                    aria-label="Raw audit event"
                    sx={{
                      m: 0,
                      mt: 1,
                      pt: 1,
                      borderTop: '1px solid',
                      borderColor: 'divider',
                      minWidth: 0,
                      fontFamily: MONO,
                      fontSize: 11,
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                      '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
                    }}
                  >
                    {JSON.stringify(row, null, 2)}
                  </Box>
                )}
              </Box>
            </Collapse>
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}
