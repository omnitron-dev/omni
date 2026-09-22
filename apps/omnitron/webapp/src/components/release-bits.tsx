/**
 * The pieces every release screen is made of.
 *
 * A release is a verdict about two commits, and the verdict is the gates: a
 * release with one failed gate is refused by a stack that requires them, and
 * an operator must be able to see WHICH one without opening anything. So the
 * gates are drawn as a strip of squares — one per gate, coloured by outcome,
 * named on hover — beside the two commits that produced them.
 *
 * `not-run` is drawn apart from `failed` on purpose. They are different
 * facts: one says the check ran and the code did not satisfy it, the other
 * says nothing was measured. A release whose gates did not run is refused
 * exactly as one whose gates failed, and the colour must not let the two
 * read as the same thing.
 */

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';

import type { GateOutcome, ReleaseSummary } from '@omnitron-dev/omnitron/dto/services';

// ---------------------------------------------------------------------------
// Numbers, as measurements
// ---------------------------------------------------------------------------

/** Bytes in the unit a person reads them in. */
export function bytes(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** `1 h 04 m`, `12 m 30 s`, `48 s` — a build is measured in minutes. */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} m ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} m`;
}

/** An ISO timestamp as `22 Sep 15:12`, in the reader's own zone. */
export function when(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

export type GateStatus = GateOutcome['status'];

export const GATE_TONE: Record<GateStatus, { color: string; label: string }> = {
  passed: { color: 'success.main', label: 'passed' },
  failed: { color: 'error.main', label: 'failed' },
  'timed-out': { color: 'warning.main', label: 'timed out' },
  killed: { color: 'warning.dark', label: 'killed' },
  'not-run': { color: 'text.disabled', label: 'did not run' },
};

/** What a gate's outcome means for deploying, in one sentence. */
export function gateSentence(gates: readonly GateOutcome[]): string {
  if (gates.length === 0) return 'No gates recorded — a stack that requires any will refuse this release.';
  const bad = gates.filter((g) => g.status !== 'passed');
  if (bad.length === 0) return `All ${gates.length} gates passed.`;
  return `${bad.length} of ${gates.length} gates did not pass: ${bad.map((g) => `${g.name} ${GATE_TONE[g.status].label}`).join(', ')}.`;
}

/**
 * Was the machine carrying more than it has cores while the gates ran?
 *
 * The five-minute average against the core count, because that is the window
 * a gate suite occupies. A red gate on such a machine is evidence about the
 * machine before it is evidence about the code — measured here, three builds
 * of one commit gave three different sets of red.
 */
export function ranLoaded(machine: ReleaseSummary['machine']): boolean {
  return machine != null && machine.loadAtGateEnd[1] > machine.cpus;
}

/** `38.1 / 56.0 / 33.9 on 16 cores`, as the build recorded it. */
export function loadWords(machine: NonNullable<ReleaseSummary['machine']>): string {
  const at = (l: readonly [number, number, number]) => l.map((n) => n.toFixed(1)).join(' / ');
  return `${at(machine.loadAtGateStart)} → ${at(machine.loadAtGateEnd)} on ${machine.cpus} cores`;
}

/**
 * One square per gate, in the order the build recorded them.
 *
 * Twenty-one gates fit in a table cell this way and a count does not: «19/21»
 * tells an operator that something failed and nothing about what, and the
 * answer decides whether the release is worth deploying at all.
 */
export function GateStrip({ gates, size = 10 }: { gates: readonly GateOutcome[]; size?: number }) {
  if (gates.length === 0) {
    return (
      <Typography variant="caption" sx={{ color: 'text.disabled' }}>
        no gates
      </Typography>
    );
  }
  return (
    <Stack direction="row" spacing={0.4} sx={{ flexWrap: 'wrap', gap: 0.4 }}>
      {gates.map((gate, i) => (
        <Tooltip
          key={`${gate.name}-${i}`}
          title={`${gate.name} — ${GATE_TONE[gate.status].label}${
            gate.durationMs ? ` (${Math.round(gate.durationMs / 1000)} s)` : ''
          }${gate.detail ? ` — ${gate.detail}` : ''}`}
          arrow
        >
          <Box
            sx={{
              width: size,
              height: size,
              borderRadius: '2px',
              bgcolor: GATE_TONE[gate.status].color,
              // `not-run` is hollow, so «nothing was measured» cannot be
              // mistaken for a muted pass at a glance.
              ...(gate.status === 'not-run' && {
                bgcolor: 'transparent',
                border: (theme: any) => `1px solid ${theme.palette.text.disabled}`,
              }),
            }}
          />
        </Tooltip>
      ))}
    </Stack>
  );
}

/** `19/21` with the colour of the worst outcome in it. */
export function GateCount({ gates }: { gates: ReleaseSummary['gates'] }) {
  const tone = gates.total === 0 ? 'text.disabled' : gates.failed > 0 ? 'error.main' : gates.notRun > 0 ? 'warning.main' : 'success.main';
  return (
    <Typography variant="body2" sx={{ fontWeight: 600, color: tone, fontFamily: 'monospace' }}>
      {gates.total === 0 ? '—' : `${gates.passed}/${gates.total}`}
    </Typography>
  );
}

// ---------------------------------------------------------------------------
// Commits
// ---------------------------------------------------------------------------

/**
 * The two commits a release is, with the one warning that matters.
 *
 * `onRemote: false` means the commit exists on this laptop and nowhere else:
 * the release can be deployed, and nobody — including this master after a
 * disk failure — could ever rebuild it. Production policy refuses those
 * (`requireOnRemote`), and the console says so before anyone tries.
 */
export function CommitPair({
  projectCommit,
  omniCommit,
  onRemote,
  project,
}: {
  projectCommit: string | null;
  omniCommit: string | null;
  onRemote: { project: boolean | null; omni: boolean | null };
  project: string;
}) {
  const local = [onRemote.project === false ? project : null, onRemote.omni === false ? 'omni' : null].filter(Boolean);
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
      <Tooltip title={`${project} ${projectCommit ?? 'unknown'}`} arrow>
        <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
          {projectCommit?.slice(0, 8) ?? '—'}
        </Typography>
      </Tooltip>
      <Typography variant="caption" sx={{ color: 'text.disabled' }}>
        +
      </Typography>
      <Tooltip title={`omni ${omniCommit ?? 'unknown'}`} arrow>
        <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
          {omniCommit?.slice(0, 8) ?? '—'}
        </Typography>
      </Tooltip>
      {local.length > 0 && (
        <Tooltip title={`No remote branch contains the ${local.join(' and ')} commit — nobody else could rebuild this release`} arrow>
          <Chip label="local only" size="small" color="warning" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
        </Tooltip>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// A build in flight
// ---------------------------------------------------------------------------

/**
 * A bar that means something.
 *
 * The percentages are not a guess at the remaining time — they are the fixed
 * points of the build, and the gates occupy 50→80 because they take two
 * thirds of the wall clock. A bar that sat at 50% for thirteen minutes would
 * be read as hung, so the phase line carries the gates' own count as they
 * answer.
 */
export function BuildBar({ percent, state }: { percent: number; state: string }) {
  const color = state === 'failed' ? 'error' : state === 'stopped' ? 'warning' : state === 'done' ? 'success' : 'primary';
  return (
    <LinearProgress
      variant="determinate"
      value={Math.min(100, Math.max(0, percent))}
      color={color as any}
      sx={{
        height: 6,
        borderRadius: 3,
        bgcolor: (theme: any) => alpha(theme.palette.text.primary, 0.08),
      }}
    />
  );
}

export const BUILD_STATE: Record<string, { label: string; color: 'info' | 'success' | 'error' | 'warning' }> = {
  running: { label: 'Building', color: 'info' },
  done: { label: 'Built', color: 'success' },
  failed: { label: 'Failed', color: 'error' },
  stopped: { label: 'Stopped', color: 'warning' },
};
