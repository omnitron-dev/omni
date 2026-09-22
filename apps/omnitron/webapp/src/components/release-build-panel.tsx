/**
 * A build, while it is happening.
 *
 * Fifteen minutes is long enough that «is it working or has it hung» is the
 * only question, and a spinner cannot answer it. So the panel shows the
 * phase the daemon is in, the percent that phase stands at, the wall clock
 * since it started, and every phase line it has passed through — the same
 * lines the terminal prints, because they are the same source.
 *
 * The gates get their own row the moment they answer, before the artifacts
 * are packed: they are half the wall clock and all of the verdict.
 */

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import { Link as RouterLink } from 'react-router-dom';

import type { BuildRecord } from '@omnitron-dev/omnitron/dto/services';
import { StopIcon } from 'src/assets/icons';

import { BUILD_STATE, BuildBar, GateStrip, elapsed, gateSentence } from './release-bits';

/** How many phase lines are kept on screen; the rest scroll. */
const VISIBLE_LINES = 60;

export function ReleaseBuildPanel({
  record,
  onStop,
  onDeploy,
  compact,
}: {
  record: BuildRecord;
  onStop?: (buildId: string) => void;
  onDeploy?: (releaseId: string) => void;
  compact?: boolean;
}) {
  const state = BUILD_STATE[record.state] ?? { label: record.state, color: 'info' as const };
  const running = record.state === 'running';
  const lines = record.history.slice(-VISIBLE_LINES);
  const request = record.request;

  return (
    <Card variant="outlined" sx={{ borderColor: running ? 'primary.main' : undefined }}>
      <CardContent sx={{ pb: 2 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1 }}>
          <Chip label={state.label} size="small" color={state.color} sx={{ fontWeight: 600 }} />
          <Typography variant="subtitle2">{request.project}</Typography>
          {record.releaseId && (
            <Typography
              component={RouterLink}
              to={`/releases/${record.releaseId}`}
              variant="caption"
              sx={{ fontFamily: 'monospace', color: 'text.secondary', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
            >
              {record.releaseId}
            </Typography>
          )}
          <Box sx={{ flex: 1 }} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {elapsed(record.durationMs)}
            {record.requestedBy ? ` · ${record.requestedBy}` : ''}
          </Typography>
          {running && onStop && (
            <Button size="small" color="warning" startIcon={<StopIcon />} onClick={() => onStop(record.buildId)}>
              Stop
            </Button>
          )}
          {record.state === 'done' && record.releaseId && onDeploy && (
            <Button size="small" variant="contained" onClick={() => onDeploy(record.releaseId!)}>
              Deploy…
            </Button>
          )}
        </Stack>

        <BuildBar percent={record.percent} state={record.state} />

        <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', mt: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {record.phase}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {record.percent}%
          </Typography>
        </Stack>

        <Stack direction="row" spacing={0.75} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
          {request.forStack && <Chip size="small" variant="outlined" label={`statics: ${request.forStack}`} sx={{ height: 20, fontSize: 11 }} />}
          {request.projectCommit && <Chip size="small" variant="outlined" label={`project ${request.projectCommit}`} sx={{ height: 20, fontSize: 11 }} />}
          {request.omniCommit && <Chip size="small" variant="outlined" label={`omni ${request.omniCommit}`} sx={{ height: 20, fontSize: 11 }} />}
          {request.skipGates && <Chip size="small" color="warning" variant="outlined" label="gates skipped" sx={{ height: 20, fontSize: 11 }} />}
          {(request.envKeys ?? []).map((key) => (
            <Chip key={key} size="small" variant="outlined" label={key} sx={{ height: 20, fontSize: 11, fontFamily: 'monospace' }} />
          ))}
        </Stack>

        {record.gates.length > 0 && (
          <Box sx={{ mt: 1.5 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {gateSentence(record.gates)}
            </Typography>
            <Box sx={{ mt: 0.5 }}>
              <GateStrip gates={record.gates} />
            </Box>
          </Box>
        )}

        {record.error && (
          <Box
            sx={{
              mt: 1.5,
              p: 1.25,
              borderRadius: 1,
              bgcolor: (theme: any) => alpha(theme.palette.error.main, 0.08),
            }}
          >
            <Typography variant="caption" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', color: 'error.main' }}>
              {record.error}
            </Typography>
          </Box>
        )}

        {!compact && lines.length > 0 && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Box
              sx={{
                maxHeight: 220,
                overflowY: 'auto',
                fontFamily: 'monospace',
                fontSize: 12,
                lineHeight: 1.7,
              }}
            >
              {lines.map((line, i) => (
                <Box key={`${line.at}-${i}`} sx={{ display: 'flex', gap: 1.5 }}>
                  <Typography component="span" variant="caption" sx={{ color: 'text.disabled', fontFamily: 'monospace' }}>
                    {line.at.slice(11, 19)}
                  </Typography>
                  <Typography component="span" variant="caption" sx={{ color: 'text.disabled', fontFamily: 'monospace', width: 34, textAlign: 'right' }}>
                    {line.percent}%
                  </Typography>
                  <Typography component="span" variant="caption" sx={{ fontFamily: 'monospace' }}>
                    {line.phase}
                  </Typography>
                </Box>
              ))}
            </Box>
          </>
        )}
      </CardContent>
    </Card>
  );
}
