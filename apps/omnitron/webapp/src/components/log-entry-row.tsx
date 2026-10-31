import { Fragment, useId, useRef, useState } from 'react';
import { Box, Button, ButtonBase, Collapse, Tooltip, Typography } from '@mui/material';
import { alpha, keyframes, useTheme, type Theme } from '@mui/material/styles';
import { ChevronRightIcon, CopyIcon, CheckIcon } from '@omnitron-dev/prism/icons';
import { useCopyToClipboard } from '@omnitron-dev/prism/core';
import type { LogEntryRow } from '@omnitron-dev/omnitron/dto/services';

const MONO = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'SF Mono', monospace";
const LEVEL_LABELS: Record<string, string> = {
  trace: 'TRC',
  debug: 'DBG',
  info: 'INF',
  warn: 'WRN',
  error: 'ERR',
  fatal: 'FTL',
};
const arrive = keyframes`from { opacity: 0; } to { opacity: 1; }`;

export function logLevelColor(level: string, theme: Theme): string {
  const tones = { info: 'info', warn: 'warning', error: 'error', fatal: 'error' } as const;
  const tone = tones[level as keyof typeof tones];
  return tone ? theme.palette[tone][theme.palette.mode === 'light' ? 'dark' : 'light'] : theme.palette.text.secondary;
}

function timeOf(value: Date | string): string {
  const date = new Date(value);
  return (
    [date.getHours(), date.getMinutes(), date.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':') +
    '.' +
    String(date.getMilliseconds()).padStart(3, '0')
  );
}

function Fields({ values }: { values: Array<[string, unknown]> }) {
  return (
    <Box
      component="dl"
      sx={{
        m: 0,
        display: 'grid',
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: '120px minmax(0, 1fr)' },
        columnGap: 2,
        rowGap: 0.5,
      }}
    >
      {values.map(([key, value]) => (
        <Fragment key={key}>
          <Typography
            component="dt"
            sx={{
              fontFamily: MONO,
              fontSize: 11,
              color: 'text.secondary',
              overflowWrap: 'anywhere',
              pt: { xs: 0.5, sm: 0 },
            }}
          >
            {key}
          </Typography>
          <Box
            component="dd"
            sx={{
              m: 0,
              minWidth: 0,
              fontFamily: MONO,
              fontSize: 11.5,
              lineHeight: 1.65,
              color: 'text.primary',
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
            }}
          >
            {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
          </Box>
        </Fragment>
      ))}
    </Box>
  );
}

/** One continuous disclosure: the event, its context, then optional raw evidence. */
export function LogEntryRowView({
  log,
  isNew,
  nodeNames,
}: {
  log: LogEntryRow;
  isNew?: boolean;
  nodeNames?: Record<string, string>;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [raw, setRaw] = useState(false);
  const id = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const clipboard = useCopyToClipboard();
  const tone = logLevelColor(log.level, theme);
  const highlighted = expanded
    ? alpha(theme.palette.primary.main, 0.045)
    : ['warn', 'error', 'fatal'].includes(log.level)
      ? alpha(tone, 0.035)
      : 'transparent';
  const capture = log.metadata?.['_omnitron'];
  const provenance = capture && typeof capture === 'object' ? (capture as Record<string, unknown>) : null;
  const context: Array<[string, unknown]> = [
    ['Application', log.app],
    ['Node', log.nodeId ? (nodeNames?.[log.nodeId] ?? log.nodeId) : 'Current node'],
    ['Event time', new Date(log.timestamp).toISOString()],
  ];
  if (typeof provenance?.['capturedAt'] === 'string') context.push(['Captured at', provenance['capturedAt']]);
  if (typeof provenance?.['timeBasis'] === 'string') context.push(['Time basis', provenance['timeBasis']]);
  if (typeof provenance?.['stream'] === 'string') context.push(['Stream', provenance['stream']]);
  if (log.traceId) context.push(['Trace', log.traceId]);
  if (log.spanId) context.push(['Span', log.spanId]);
  if (log.labels && Object.keys(log.labels).length) context.push(['Labels', log.labels]);
  const fields = Object.entries(log.metadata ?? {}).filter(
    ([key]) => !['_omnitron', '_omnitronPayloadSha256'].includes(key)
  );
  const serialized = () => JSON.stringify(log, null, 2);

  return (
    <Box
      sx={{
        minWidth: 0,
        bgcolor: highlighted,
        borderLeft: '2px solid',
        borderLeftColor: expanded ? tone : 'transparent',
        animation: isNew ? `${arrive} 180ms ease-out` : undefined,
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && expanded) {
          event.preventDefault();
          event.stopPropagation();
          setExpanded(false);
          toggle.current?.focus();
        }
      }}
    >
      <ButtonBase
        ref={toggle}
        disableRipple
        aria-expanded={expanded}
        aria-controls={expanded ? id : undefined}
        aria-label={`${timeOf(log.timestamp)} ${log.app} ${log.level}: ${log.message}`}
        onClick={() => setExpanded((value) => !value)}
        sx={{
          width: '100%',
          minWidth: 0,
          textAlign: 'left',
          display: 'grid',
          gridTemplateColumns: { xs: '16px 90px minmax(0, 1fr) 32px', sm: '16px 90px 120px 32px minmax(0, 1fr)' },
          columnGap: 1,
          alignItems: 'start',
          px: 1.25,
          py: 0.5,
          '&:hover': { bgcolor: alpha(theme.palette.text.primary, 0.04) },
          '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
        }}
      >
        <ChevronRightIcon
          aria-hidden
          sx={{
            fontSize: 16,
            mt: '2px',
            color: expanded ? tone : 'text.disabled',
            transform: expanded ? 'rotate(90deg)' : undefined,
          }}
        />
        <Tooltip title={new Date(log.timestamp).toISOString()} enterDelay={400}>
          <Typography
            component="span"
            sx={{ fontFamily: MONO, fontSize: 11, lineHeight: '20px', color: 'text.secondary', whiteSpace: 'nowrap' }}
          >
            {timeOf(log.timestamp)}
          </Typography>
        </Tooltip>
        <Typography
          component="span"
          title={log.app}
          sx={{
            fontFamily: MONO,
            fontSize: 11,
            lineHeight: '20px',
            color: 'text.secondary',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            minWidth: 0,
          }}
        >
          {log.app}
        </Typography>
        <Typography
          component="span"
          sx={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, lineHeight: '20px', color: tone }}
        >
          {LEVEL_LABELS[log.level] ?? log.level.slice(0, 3).toUpperCase()}
        </Typography>
        <Typography
          component="span"
          sx={{
            gridColumn: { xs: '2 / -1', sm: 'auto' },
            minWidth: 0,
            fontFamily: MONO,
            fontSize: 11.5,
            lineHeight: '20px',
            color: ['error', 'fatal'].includes(log.level) ? tone : 'text.primary',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: expanded ? 'pre-wrap' : 'nowrap',
            overflowWrap: 'anywhere',
          }}
        >
          {log.message}
        </Typography>
      </ButtonBase>
      <Collapse in={expanded} timeout={0} unmountOnExit>
        <Box id={id} sx={{ minWidth: 0, pl: '34px', pr: 1.5, pb: 1.5 }}>
          <Box sx={{ pt: 1.25, mt: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
            <Fields values={context} />
          </Box>
          {fields.length > 0 && (
            <Box sx={{ mt: 1.25, pt: 1.25, borderTop: '1px solid', borderColor: 'divider' }}>
              <Fields values={fields} />
            </Box>
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 1 }}>
            <Button
              size="small"
              color="inherit"
              onClick={() => setRaw((value) => !value)}
              aria-expanded={raw}
              aria-controls={raw ? `${id}-raw` : undefined}
              startIcon={<ChevronRightIcon sx={{ transform: raw ? 'rotate(90deg)' : undefined }} />}
              sx={{ fontSize: 11, color: 'text.secondary', minHeight: 32 }}
            >
              Raw event
            </Button>
            <Button
              size="small"
              onClick={() => void clipboard.copy(serialized())}
              startIcon={clipboard.state === 'success' ? <CheckIcon /> : <CopyIcon />}
              sx={{ fontSize: 11, minHeight: 32 }}
            >
              {clipboard.state === 'success' ? 'Copied' : clipboard.state === 'error' ? 'Retry copy JSON' : 'Copy JSON'}
            </Button>
            {clipboard.state === 'error' && (
              <Typography role="status" variant="caption" color="error">
                Clipboard unavailable. Open Raw event to select the text.
              </Typography>
            )}
          </Box>
          {raw && (
            <Box
              id={`${id}-raw`}
              component="pre"
              tabIndex={0}
              aria-label="Raw log event"
              sx={{
                mt: 1,
                mb: 0,
                pt: 1,
                borderTop: '1px solid',
                borderColor: 'divider',
                fontFamily: MONO,
                fontSize: 11,
                lineHeight: 1.7,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                minWidth: 0,
                color: 'text.secondary',
                '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
              }}
            >
              {serialized()}
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}
