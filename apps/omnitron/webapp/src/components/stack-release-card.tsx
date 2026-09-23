/**
 * What this stack is carrying, and whether anything newer exists.
 *
 * This is the question an operator actually has in front of a stack — «is
 * test running the latest?» — and before this card the console could not
 * answer it at all: the stacks page showed six apps online and said nothing
 * about which build they were.
 *
 * It is careful about what it claims. The daemon's running state lives in
 * memory and a restart empties it, so «running» is not something this can
 * know; what it knows is the last recorded `stack.start` — who asked, when,
 * and which release went out, from the audit trail, which survives. The
 * wording says that, because a console that says «running» about a row in a
 * log has told the operator something it did not check.
 */

import { useMemo } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { DeployIcon } from 'src/assets/icons';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { releaseApi } from 'src/netron/release-wire';

import { GateCount, GateStrip, when } from './release-bits';

export function StackReleaseCard({
  project,
  stack,
  requiresRelease,
  local,
  onDeploy,
}: {
  project: string;
  stack: string;
  requiresRelease: boolean;
  local: boolean;
  onDeploy: () => void;
}) {
  const { data, error } = usePolledResource(
    async () => {
      const [list, deployments] = await Promise.all([releaseApi.list(), releaseApi.deployments(200)]);
      return { releases: list.releases, deployments };
    },
    { intervalMs: 20_000, enabled: !local },
  );

  const last = useMemo(
    () =>
      data?.deployments.known
        ? (data.deployments.deployments.find((d) => d.project === project && d.stack === stack) ?? null)
        : null,
    [data?.deployments, project, stack],
  );
  /** Why this card cannot say which release the stack runs — not the same as «none». */
  const unknown = data && !data.deployments.known ? data.deployments.why : null;
  const deployed = useMemo(
    () => (last?.release ? (data?.releases ?? []).find((r) => r.id === last.release) ?? null : null),
    [data?.releases, last?.release],
  );
  /** The newest COMPLETE release built for this project, whatever its gates. */
  const newest = useMemo(
    () => (data?.releases ?? []).find((r) => r.project === project && r.complete) ?? null,
    [data?.releases, project],
  );
  const behind = newest && last?.release && newest.id !== last.release;

  if (local) return null;

  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardContent>
        <Stack direction="row" spacing={1.5} sx={{ mb: 1, alignItems: 'center' }}>
          <Typography variant="overline" sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>
            Release
          </Typography>
          {requiresRelease && (
            <Tooltip title="This stack's config says release.mode = required: a plain Start is refused, deliberately." arrow>
              <Chip label="releases only" size="small" color="info" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
            </Tooltip>
          )}
          <Box sx={{ flex: 1 }} />
          <Button size="small" variant="contained" startIcon={<DeployIcon />} onClick={onDeploy}>
            Deploy release…
          </Button>
        </Stack>

        {error && (
          <Typography variant="caption" sx={{ color: 'warning.main' }}>
            The release store could not be read — {error}
          </Typography>
        )}

        {unknown && !error && (
          <Typography variant="body2" sx={{ color: 'warning.main' }}>
            Which release this stack runs is unknown — {unknown}.
          </Typography>
        )}

        {data && !last && !unknown && !error && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            No recorded deployment of this stack yet.
          </Typography>
        )}

        {last && (
          <Stack spacing={0.75}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              {last.release ? (
                <Typography
                  component={RouterLink}
                  to={`/releases/${last.release}`}
                  variant="body2"
                  sx={{ fontFamily: 'monospace', fontWeight: 600, textDecoration: 'none', color: 'text.primary', '&:hover': { color: 'primary.main' } }}
                >
                  {last.release}
                </Typography>
              ) : last.releaseUnnamed ? (
                <Tooltip
                  title="A release went out, and this row cannot name it — it was written before the audit trail flattened that field"
                  arrow
                >
                  <Chip label="a release, name not recorded" size="small" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
                </Tooltip>
              ) : (
                <Tooltip title="Started from the master's working tree — no release named" arrow>
                  <Chip label="working tree" size="small" color="warning" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
                </Tooltip>
              )}
              {deployed && <GateCount release={deployed} />}
              {deployed && <GateStrip gates={deployed.gateList} size={8} columns={11} />}
            </Stack>
            {deployed && (
              <Typography
                variant="caption"
                sx={{
                  color: (() => {
                    const v = deployed.verified.find((x) => x.stack === stack);
                    if (!v) return 'text.secondary';
                    return v.passed === v.total ? 'success.main' : 'warning.main';
                  })(),
                }}
              >
                {(() => {
                  // The promotion question, answered where it is asked: has
                  // what this stack carries been measured HERE? A stack whose
                  // policy another stack's `verifiedOn` names is the one whose
                  // answer production waits for.
                  const v = deployed.verified.find((x) => x.stack === stack);
                  return v
                    ? `verified here: ${v.passed} of ${v.total} probes passed, measured ${when(v.at)}`
                    : 'not verified on this stack — its probes have not been run against this release';
                })()}
              </Typography>
            )}
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              last deployed {when(last.at)} · {last.source ?? 'unknown'}
              {last.actorId ? ` · ${last.actorId}` : ''}
              {last.projectCommit ? ` · ${project} ${last.projectCommit}` : ''}
              {last.omniCommit ? ` + omni ${last.omniCommit}` : ''}
            </Typography>
            {behind && newest && (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Chip label="newer release available" size="small" color="info" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
                <Typography
                  component={RouterLink}
                  to={`/releases/${newest.id}`}
                  variant="caption"
                  sx={{ fontFamily: 'monospace', color: 'text.secondary', textDecoration: 'none' }}
                >
                  {newest.id}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  built {when(newest.builtAt)}
                </Typography>
              </Stack>
            )}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
