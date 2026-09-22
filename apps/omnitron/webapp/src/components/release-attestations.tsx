/**
 * What the stacks measured about a release after carrying it.
 *
 * The gates say what a clean clone could check. Some things only a running
 * system can answer — revocation, token binding, the paywall — and those are
 * the probes a stack runs against the release it is carrying. Production
 * asks for them by name (`verifiedOn`), so this card is where an operator
 * sees whether a release is promotable, and runs the probes if it is not yet.
 *
 * The run is long — an upload and a probe suite over SSH — and the console
 * reaches the daemon through a gateway that gives up at 120 seconds. The
 * daemon does not: the run continues and the result is written to disk
 * either way. So a gateway timeout here is said as what it is, and the card
 * keeps watching for the attestation to land instead of calling it a
 * failure.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import type { IStackInfo, StoredAttestation } from '@omnitron-dev/omnitron/dto/services';
import { daemonClient } from 'src/netron/client';
import { useProjectStore } from 'src/stores/project.store';

import { GATE_TONE, GateStrip, when } from './release-bits';

type AttestAnswer = {
  path: string;
  gates: number;
  passed: number;
  node: string;
  scriptsFrom: 'release' | 'history';
  /** Absent from a daemon older than the field. */
  sourceFiles?: number;
};

/**
 * The run, with a deadline that fits it.
 *
 * Through the untyped invoke because the typed proxy carries the console's
 * 30-second default; the gateway still cuts at 120 s, and that case is
 * handled by watching for the result rather than by pretending it failed.
 */
function attestOnNode(release: string, stack: string): Promise<AttestAnswer> {
  return daemonClient.invoke<AttestAnswer>('daemon', 'OmnitronRelease', 'attestOnNode', [{ release, stack }], {
    timeout: 600_000,
  });
}

/**
 * What a probe printed, folded until asked for.
 *
 * The finding in the probe's own words — the column and the value — which the
 * one-line `detail` beside it cannot hold. Present only when the producer
 * sent it; the master keeps the last 4 KB.
 */
function ProbeOutput({ output }: { output: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Box sx={{ pl: 2, mb: 0.5 }}>
      <Button size="small" onClick={() => setOpen((o) => !o)} sx={{ minWidth: 0, p: 0, fontSize: 11, textTransform: 'none' }}>
        {open ? 'hide what it printed' : 'what it printed'}
      </Button>
      {open && (
        <Box
          component="pre"
          sx={{
            m: 0,
            mt: 0.5,
            p: 1,
            maxHeight: 240,
            overflow: 'auto',
            borderRadius: 1,
            bgcolor: 'action.hover',
            fontFamily: 'monospace',
            fontSize: 11,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {output}
        </Box>
      )}
    </Box>
  );
}

/** A gateway or client deadline, as opposed to the daemon refusing. */
function isDeadline(message: string): boolean {
  return /^HTTP 50\d|Request timeout|Gateway Time-?out/i.test(message);
}

export function ReleaseAttestations({
  releaseId,
  project,
  attestations,
  onChanged,
}: {
  releaseId: string;
  project: string;
  attestations: readonly StoredAttestation[];
  onChanged: () => void;
}) {
  const stacksByProject = useProjectStore((s) => s.stacksByProject);
  const fetchStacks = useProjectStore((s) => s.fetchStacks);
  const remote = useMemo(
    () => (stacksByProject[project] ?? []).filter((s: IStackInfo) => s.type !== 'local'),
    [stacksByProject, project],
  );
  const [stack, setStack] = useState('');
  const [running, setRunning] = useState(false);
  const [answer, setAnswer] = useState<AttestAnswer | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);

  useEffect(() => {
    if (!stacksByProject[project]) void fetchStacks(project);
  }, [project, stacksByProject, fetchStacks]);

  useEffect(() => {
    if (!stack && remote.length > 0) setStack(remote[0]!.name);
  }, [remote, stack]);

  // After a gateway timeout: watch for the attestation the daemon is still
  // producing, by asking the page to refresh until one newer than the press
  // appears — ten minutes at most, which is past any probe suite's deadline.
  useEffect(() => {
    if (waitingSince === null) return undefined;
    const landed = attestations.some((a) => a.stack === stack && Date.parse(a.storedAt) >= waitingSince);
    if (landed || Date.now() - waitingSince > 600_000) {
      setWaitingSince(null);
      return undefined;
    }
    const timer = setTimeout(onChanged, 5_000);
    return () => clearTimeout(timer);
  }, [waitingSince, attestations, stack, onChanged]);

  const run = useCallback(async () => {
    if (!stack) return;
    const pressedAt = Date.now();
    setRunning(true);
    setFailure(null);
    setAnswer(null);
    try {
      setAnswer(await attestOnNode(releaseId, stack));
      onChanged();
    } catch (err) {
      const message = (err as Error).message;
      if (isDeadline(message)) setWaitingSince(pressedAt);
      else setFailure(message);
    } finally {
      setRunning(false);
    }
  }, [releaseId, stack, onChanged]);

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1.5 }}>
          <Typography variant="subtitle2">Verified on stacks</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            probes a running stack measured against this release
          </Typography>
          <Box sx={{ flex: 1 }} />
          {remote.length > 0 && (
            <>
              <TextField
                select
                size="small"
                value={stack}
                onChange={(e) => setStack(e.target.value)}
                disabled={running}
                sx={{ minWidth: 120 }}
              >
                {remote.map((s) => (
                  <MenuItem key={s.name} value={s.name}>
                    {s.name}
                  </MenuItem>
                ))}
              </TextField>
              <Tooltip
                title="Uploads this release's own scripts to the stack's node and runs the probes there, under the node's deploy lease. The stack should be carrying this release — an attestation older than the last deployment is refused."
                arrow
              >
                <span>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => void run()}
                    disabled={running || waitingSince !== null || !stack}
                    startIcon={running || waitingSince !== null ? <CircularProgress size={14} /> : undefined}
                  >
                    {running ? 'Running on the node…' : waitingSince !== null ? 'Still running…' : 'Run the probes'}
                  </Button>
                </span>
              </Tooltip>
            </>
          )}
        </Stack>

        {waitingSince !== null && (
          <Alert severity="info" sx={{ mb: 1.5 }}>
            The gateway stopped waiting after 120 seconds; the master did not. The probes are still running on the node,
            and the result will appear here when it is written.
          </Alert>
        )}
        {answer && (
          <Alert severity={answer.passed === answer.gates ? 'success' : 'warning'} sx={{ mb: 1.5 }}>
            {answer.passed} of {answer.gates} probes passed on {answer.node} — probes from{' '}
            {answer.scriptsFrom === 'release' ? 'the release itself' : "the release's commit"}
            {typeof answer.sourceFiles === 'number' &&
              (answer.sourceFiles > 0
                ? `, with ${answer.sourceFiles} application source files from that commit`
                : ', with no application sources — probes that read code said NOT RUN')}
            .
          </Alert>
        )}
        {failure && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {failure}
            </Typography>
          </Alert>
        )}

        {attestations.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            No stack has attested this release. A stack whose policy declares <code>verifiedOn</code> refuses it until one
            does.
          </Typography>
        ) : (
          <Stack spacing={2}>
            {attestations.map((a) => {
              const passed = a.gates.filter((g) => g.status === 'passed').length;
              return (
                <Box key={a.stack}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <Chip label={a.stack} size="small" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 600,
                        fontFamily: 'monospace',
                        color: passed === a.gates.length ? 'success.main' : 'error.main',
                      }}
                    >
                      {passed}/{a.gates.length}
                    </Typography>
                    <GateStrip gates={a.gates} size={9} />
                    <Box sx={{ flex: 1 }} />
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      measured {when(a.at)}
                      {a.onNode.hosts.length > 0 ? ` on ${a.onNode.hosts.join(', ')}` : ''}
                    </Typography>
                    {a.onNode.claimed && (
                      <Tooltip
                        title={
                          a.onNode.matched === true
                            ? "The producer confirmed it ran on one of the stack's nodes."
                            : 'The producer could not confirm the machine it ran on.'
                        }
                        arrow
                      >
                        <Chip
                          label={a.onNode.matched === true ? 'on the node' : 'node unconfirmed'}
                          size="small"
                          color={a.onNode.matched === true ? 'success' : 'warning'}
                          variant="outlined"
                          sx={{ height: 18, fontSize: 10 }}
                        />
                      </Tooltip>
                    )}
                  </Stack>
                  {a.gates.some((g) => g.status !== 'passed') && (
                    <Box sx={{ mt: 0.75, pl: 1 }}>
                      {a.gates
                        .filter((g) => g.status !== 'passed')
                        .map((g) => (
                          <Box key={g.name}>
                            <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                              <Box component="span" sx={{ color: GATE_TONE[g.status].color, fontWeight: 600 }}>
                                {GATE_TONE[g.status].label}
                              </Box>{' '}
                              <Box component="span" sx={{ fontFamily: 'monospace' }}>
                                {g.name}
                              </Box>
                              {g.detail ? ` — ${g.detail}` : ''}
                            </Typography>
                            {g.output && <ProbeOutput output={g.output} />}
                          </Box>
                        ))}
                    </Box>
                  )}
                </Box>
              );
            })}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
