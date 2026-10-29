import { Link as RouterLink } from 'react-router-dom';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { DiagnosticEvent } from '@omnitron-dev/omnitron/diagnostics';
import { logHref } from 'src/utils/log-location';

/** Older nodes have no projection. Malformed remote details never become renderable data. */
function readable(value: unknown): value is { event: DiagnosticEvent; occurrences: number } {
  if (!value || typeof value !== 'object') return false;
  const item = value as { event?: Partial<DiagnosticEvent>; occurrences?: unknown };
  return Boolean(item.event && typeof item.event.id === 'string' && typeof item.event.title === 'string'
    && Array.isArray(item.event.evidence) && item.event.evidence.every(text => typeof text === 'string')
    && (item.event.remedy === undefined || typeof item.event.remedy === 'string') && typeof item.occurrences === 'number');
}

export function RuntimeDiagnosticDetails({ active, nodeName }: { active: unknown; nodeName?: string | undefined }) {
  const items = Array.isArray(active) ? active.filter(readable).slice(0, 100) : [];
  if (!items.length) return null;
  return <Accordion disableGutters elevation={0} sx={{ minWidth: 0, mt: 1, '&:before': { display: 'none' } }}>
    <AccordionSummary aria-label="Runtime diagnostic evidence">
      <Typography variant="body2">Evidence and recovery · {items.length}</Typography>
    </AccordionSummary>
    <AccordionDetails>
      <Stack spacing={2} sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        {items.map(({ event, occurrences }) => <Stack key={event.id} spacing={0.5}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{event.title}</Typography>
          <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>{event.id} · {occurrences} occurrence(s)</Typography>
          {event.evidence.map((text, index) => <Typography variant="body2" key={index}>{text}</Typography>)}
          {event.remedy && <Typography variant="body2" sx={{ color: 'text.secondary' }}>{event.remedy}</Typography>}
        </Stack>)}
        <Button component={RouterLink} to={logHref('omnitron', nodeName)} size="small" sx={{ alignSelf: 'flex-start' }}>Open daemon logs</Button>
      </Stack>
    </AccordionDetails>
  </Accordion>;
}
