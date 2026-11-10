/**
 * What a deployment is actually doing, per app and per node.
 *
 * The deployments table shows a record with one status — `deploying` — from
 * the first second to the last. A remote deployment is four phases with very
 * different costs: transferring the artifact takes seconds, installing its
 * dependencies on the node takes minutes, starting and verifying take a few
 * more. The daemon published every one of them, and the console polled, and
 * an event with nowhere to wait is an event nobody sees.
 *
 * So for the quarter of an hour a six-app stack takes, an operator watching
 * this console could not tell a deployment that was working from one that had
 * hung, and when one failed the message naming the failing step went to a
 * handler that re-emitted it to nobody. Both are here now, per app.
 */

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import type { DeployProgressRecord } from '@omnitron-dev/omnitron/dto/services';
import { deploymentProgressKey } from '@omnitron-dev/omnitron/release-reading';

type Status = DeployProgressRecord['status'];

/**
 * What each phase is called, and what it costs.
 *
 * The labels say what the daemon is doing on the operator's behalf rather
 * than naming the internal step, and `installing` says where, because "why is
 * this taking four minutes" has an answer and the answer is that npm is
 * resolving a dependency tree on a machine in another country.
 */
const PHASES: Record<Status, { label: string; tone: 'info' | 'success' | 'error' | 'default' }> = {
  waiting: { label: 'Waiting for node', tone: 'info' },
  pending: { label: 'Connecting', tone: 'default' },
  transferring: { label: 'Transferring artifact', tone: 'info' },
  extracting: { label: 'Unpacking', tone: 'info' },
  installing: { label: 'Installing dependencies on the node', tone: 'info' },
  restarting: { label: 'Starting', tone: 'info' },
  verifying: { label: 'Verifying', tone: 'info' },
  success: { label: 'Deployed', tone: 'success' },
  failed: { label: 'Failed', tone: 'error' },
};

/** Phases that are still going, so a caller can separate live from finished. */
export function isInFlight(status: Status): boolean {
  return status !== 'success' && status !== 'failed';
}

/**
 * How long ago, in words that fit a chip.
 *
 * Deliberately coarse. A deployment phase is interesting at the scale of
 * seconds and minutes, and a timestamp to the second invites reading it as a
 * measurement of something.
 */
export function ago(iso: string, now: number = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return 'time not reported';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function awaitingUpdate(record: DeployProgressRecord, now: number, unavailable: boolean): boolean {
  return isInFlight(record.status) && (unavailable || !Number.isFinite(Date.parse(record.at)) || now - Date.parse(record.at) > 90_000);
}

function Row({ record, now, unavailable }: { record: DeployProgressRecord; now: number; unavailable: boolean }) {
  const phase = PHASES[record.status] ?? { label: record.status, tone: 'default' as const };
  const uncertain = awaitingUpdate(record, now, unavailable);
  const live = isInFlight(record.status) && !uncertain;

  return (
    <Box sx={{ py: 1 }}>
      <Stack direction="row" spacing={1} sx={{ mb: 0.5, alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>
          {record.app === '*' ? 'Node provisioning' : record.app}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace', overflowWrap: 'anywhere' }}>
          {record.node}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Chip size="small" variant="outlined" color={phase.tone} label={phase.label} sx={{ maxWidth: '100%', fontWeight: 600 }} />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {ago(record.at, now)}
        </Typography>
      </Stack>

      {/*
        An indeterminate bar while a phase is running, a determinate one when
        it has stopped. The percentage a deployment reports is the phase it
        reached, not work completed: showing 60% creeping for four minutes
        would be a measurement of nothing, and an operator would read it as
        one.
      */}
      <LinearProgress
        aria-label={`${record.app === '*' ? 'Node provisioning' : record.app} on ${record.node}`}
        variant={live ? 'indeterminate' : 'determinate'}
        value={record.status === 'success' ? 100 : record.progress}
        color={uncertain ? 'warning' : phase.tone === 'default' ? 'inherit' : phase.tone}
        sx={{ height: 4, borderRadius: 2 }}
      />

      {uncertain && <Typography role="status" variant="caption" color="warning.main">
        Awaiting an updated report; completion is unknown. A long phase may still be running.
      </Typography>}

      {/*
        The message, always — not only on failure. It is the only place that
        says WHY: "the installed tree cannot resolve @omnitron-dev/omnitron,
        so the app will fail at its first import" is a sentence an operator
        can act on, and it used to go nowhere.
      */}
      {record.message ? (
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            mt: 0.5,
            color: record.status === 'failed' ? 'error.main' : 'text.secondary',
            wordBreak: 'break-word',
          }}>
          {record.message}
        </Typography>
      ) : null}
      {record.operationId && <Box component="details" sx={{ mt: 0.5, typography: 'caption', color: 'text.secondary', overflowWrap: 'anywhere',
        '& summary': { cursor: 'pointer', width: 'fit-content' } }}>
        <summary>Transfer details</summary>
        <div>{record.project}/{record.stack} · {record.at}</div>
        <div>Operation <code>{record.operationId}</code></div>
        {record.releaseId && <div>Release <code>{record.releaseId}</code></div>}
      </Box>}
    </Box>
  );
}

export interface DeployProgressListProps {
  records: readonly DeployProgressRecord[];
  /** Retained records cannot establish live progress after the source fails. */
  unavailable?: boolean;
  /** Injected so a test can pin the relative times. */
  now?: number;
}

/**
 * Every app the daemon has touched, newest first.
 *
 * Nothing at all when there is nothing to say — an empty panel headed
 * "Live deployments" on a console where nobody is deploying is a widget that
 * has to be scrolled past forever.
 */
export function DeployProgressList({ records, now = Date.now(), unavailable = false }: DeployProgressListProps) {
  if (records.length === 0) return null;

  const inFlight = records.filter((r) => isInFlight(r.status) && !awaitingUpdate(r, now, unavailable)).length;

  return (
    <Box sx={{ mb: 3 }}>
      <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center' }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Deployment progress
        </Typography>
        {inFlight > 0 ? (
          <Chip size="small" color="info" variant="filled" label={`${inFlight} in flight`} sx={{ fontWeight: 600 }} />
        ) : null}
      </Stack>
      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, px: 2, py: 0.5 }}>
        {records.map((record) => (
          <Row key={deploymentProgressKey(record)} record={record} now={now} unavailable={unavailable} />
        ))}
      </Box>
    </Box>
  );
}
