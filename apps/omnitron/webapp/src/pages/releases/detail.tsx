/**
 * One release, in full.
 *
 * Everything the manifest records, drawn as what it is used for: the two
 * commits and whether anyone else could rebuild them; every gate with its
 * outcome, its duration and its own words; every artifact with the checksum
 * the node will recompute; the static bundle and which stack's environment
 * it was built with; and the logs each step left, so a failed build can be
 * read here instead of over ssh.
 *
 * `builtWith` is on this page and not only in the file. Three fixes
 * committed together once reached a stand as two, because the daemon
 * restarted sixteen seconds before the third package's `dist` was rebuilt —
 * the commit was identical in all three cases and what was packed was not.
 */

import { useCallback, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { Breadcrumbs } from 'src/components/page-breadcrumbs';
import { LoadingScreen } from '@omnitron-dev/prism/components/loading-screen';

import type { ReleaseSummary } from '@omnitron-dev/omnitron/dto/services';
import { DeployIcon, RefreshIcon } from 'src/assets/icons';
import { DeployReleaseDialog } from 'src/components/deploy-release-dialog';
import { ReleaseAttestations } from 'src/components/release-attestations';
import { ReleaseBuildPanel } from 'src/components/release-build-panel';
import { ReleaseDeploymentState } from 'src/components/release-deployment-state';
import { readSourcePublication, releaseTargetLabel } from '@omnitron-dev/omnitron/release-reading';
import { GATE_TONE, GateStrip, bytes, elapsed, loadWords, ranLoaded, when } from 'src/components/release-bits';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { Can, useAccess } from 'src/auth/access';
import { OperationStatus } from 'src/components/operation-status';
import { releases as releaseRpc } from 'src/netron/client';
import { releaseApi } from 'src/netron/release-wire';

export default function ReleaseDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  return <ReleaseDetails key={id} id={id} />;
}

function ReleaseDetails({ id }: { id: string }) {
  const { can } = useAccess();
  const mayReadBuilds = can('OmnitronRelease.builds');
  const mayReadLogs = can('OmnitronRelease.getLog');
  const logRequest = useRef(0);
  const [readingLog, setReadingLog] = useState<string | null>(null);
  const [deployOpen, setDeployOpen] = useState(false);
  const [log, setLog] = useState<{ name: string; tail: string } | null>(null);
  const [logError, setLogError] = useState<string | null>(null);

  const { data, loading, error, refresh } = usePolledResource(
    async () => {
      const [detail, builds] = await Promise.all([
        releaseApi.get(id),
        mayReadBuilds ? releaseApi.builds().then(records => ({ records, error: null }))
          .catch((err: Error) => ({ records: [], error: err.message })) : { records: [], error: null },
      ]);
      return { detail, builds };
    },
    { intervalMs: 15_000, enabled: Boolean(id), resourceKey: JSON.stringify([id, mayReadBuilds]) },
  );

  const openLog = useCallback(
    async (name: string) => {
      const request = ++logRequest.current;
      setReadingLog(name);
      setLog(null);
      setLogError(null);
      try {
        const answer = await releaseRpc.getLog({ id, name, lines: 400 });
        if (request === logRequest.current) setLog({ name: answer.name, tail: answer.tail });
      } catch (err) {
        if (request === logRequest.current) setLogError((err as Error).message);
      } finally {
        if (request === logRequest.current) setReadingLog(null);
      }
    },
    [id],
  );

  if (loading && !data) return <LoadingScreen />;
  if (error && !data) {
    return (
      <Stack spacing={3}>
        <Breadcrumbs links={[{ name: 'Releases', href: '/releases' }, { name: id }]} />
        <Alert severity="error" variant="outlined">
          {error}
        </Alert>
      </Stack>
    );
  }

  const release = data!.detail;
  const manifest = release.manifest;
  const build = data!.builds.records.find((b) => b.releaseId === id) ?? null;

  return (
    <Stack spacing={3}>
      <Breadcrumbs
        links={[{ name: 'Releases', href: '/releases' }, { name: id }]}
        action={
          <Stack direction="row" spacing={1}>
            <IconButton data-console-command="refresh" size="small" onClick={() => void refresh()} title="Refresh">
              <RefreshIcon />
            </IconButton>
            <Can permission="OmnitronProject.startStack"><Button
              variant="contained"
              size="small"
              startIcon={<DeployIcon />}
              disabled={!release.complete}
              onClick={() => setDeployOpen(true)}
            >
              Deploy…
            </Button></Can>
          </Stack>
        }
      />

      {error && <Alert severity="warning">Last confirmed manifest · {error}</Alert>}
      {data?.builds.error && <Alert severity="warning">Build activity unavailable · {data.builds.error}</Alert>}
      {!release.complete && (
        <Alert severity="warning" variant="outlined">
          This directory holds no manifest: the build did not finish, and what is here is its logs. Nothing can be
          deployed from it.
        </Alert>
      )}

      {build && <ReleaseBuildPanel record={build} compact={build.state !== 'running'} />}

      <ReleaseDeploymentState key={release.project} project={release.project} />

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
                Built from
              </Typography>
              <Stack spacing={1.5}>
                {([['project', release.projectCommit, release.projectRepo, release.onRemote.project],
                   ['omni', release.omniCommit, release.omniRepo, release.onRemote.omni]] as const).map(
                  ([what, commit, repo, onRemote]) => (
                    <Box key={what}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 56 }}>
                          {what === 'project' ? release.project : 'omni'}
                        </Typography>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                          {commit?.slice(0, 12) ?? '—'}
                        </Typography>
                        {onRemote === false && (
                          <Tooltip title={readSourcePublication({ project: onRemote, omni: true }, what === 'project' ? release.project : 'omni').detail}><Chip label="Git: no remote branch" size="small" color="warning" variant="outlined" /></Tooltip>
                        )}
                        {onRemote === null && (
                          <Chip label="Git: not checked" size="small" variant="outlined" />
                        )}
                      </Stack>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {repo ?? '—'}
                      </Typography>
                    </Box>
                  ),
                )}
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
                Built with
              </Typography>
              <Stack spacing={0.75}>
                <Typography variant="body2">
                  {when(release.builtAt)} · {release.builtBy ?? '—'}
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 13 }}>
                  omnitron {release.builtWith ?? '—'}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {releaseTargetLabel(manifest?.builtWith?.target)}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {manifest?.builtWith?.packages?.length ?? 0} linked omni package(s); {bytes(release.bytes)} on disk at{' '}
                  {release.root}
                </Typography>
                {release.statics && (
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    statics for <strong>{release.statics.stack}</strong> — {release.statics.files} files,{' '}
                    {bytes(release.statics.bytes)} from {manifest?.statics?.dir}
                  </Typography>
                )}
                {release.machine && (
                  <Typography
                    variant="caption"
                    sx={{ color: ranLoaded(release.machine) ? 'warning.main' : 'text.secondary' }}
                  >
                    machine while the gates ran: {loadWords(release.machine)}
                    {ranLoaded(release.machine) ? ' — load exceeded core count; inspect the gate logs for failure causes' : ''}
                  </Typography>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Card variant="outlined">
        <CardContent>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1.5 }}>
            <Typography variant="subtitle2">Gates</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {release.gates.total === 0
                ? 'none recorded — a stack that requires any refuses this release'
                : `${release.gates.passed} of ${release.gates.total} passed`}
            </Typography>
            <Box sx={{ flex: 1 }} />
            <GateStrip gates={release.gateList} />
          </Stack>
          {release.gateList.length > 0 && (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Gate</TableCell>
                  <TableCell>Outcome</TableCell>
                  <TableCell align="right">Took</TableCell>
                  <TableCell>Detail</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {release.gateList.map((gate, i) => (
                  <TableRow key={`${gate.name}-${i}`}>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 13 }}>
                      {gate.name}
                      {gate.checks != null && (
                        <Typography component="span" variant="caption" sx={{ color: 'text.secondary', ml: 1 }}>
                          {gate.checks} checks
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ color: GATE_TONE[gate.status].color, fontWeight: 600 }}>
                        {GATE_TONE[gate.status].label}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
                        {gate.durationMs ? elapsed(gate.durationMs) : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'pre-wrap' }}>
                        {gate.detail ?? ''}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {release.complete && (
        <ReleaseAttestations
          releaseId={release.id}
          project={release.project}
          attestations={release.attestations}
          onChanged={() => void refresh()}
        />
      )}

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
            Artifacts
          </Typography>
          {(manifest?.artifacts ?? []).length === 0 ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              None.
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>App</TableCell>
                  <TableCell>Version</TableCell>
                  <TableCell align="right">Size</TableCell>
                  <TableCell>sha256</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(manifest?.artifacts ?? []).map((a) => (
                  <TableRow key={`${a.app}-${a.version}`}>
                    <TableCell sx={{ fontWeight: 600 }}>{a.app}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 13 }}>{a.version}</TableCell>
                    <TableCell align="right" sx={{ fontFamily: 'monospace', fontSize: 13 }}>
                      {bytes(a.bytes)}
                    </TableCell>
                    <TableCell>
                      <Tooltip title={a.sha256 || 'none recorded'} arrow>
                        <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                          {a.sha256 ? `${a.sha256.slice(0, 16)}…` : '—'}
                        </Typography>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {(manifest?.artifactFailures ?? []).map((f) => (
            <Alert key={f.app} severity="error" variant="outlined" sx={{ mt: 1 }}>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                <strong>{f.app}</strong> did not build — {f.error.split('\n')[0]}
              </Typography>
            </Alert>
          ))}
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
            Build logs
          </Typography>
          {release.logs.length === 0 ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              This build wrote no logs.
            </Typography>
          ) : (
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
              {release.logs.map((l) => (
                <Chip
                  key={l.name}
                  label={`${l.name} · ${bytes(l.bytes)}`}
                  size="small"
                  variant={log?.name === l.name ? 'filled' : 'outlined'}
                  disabled={!mayReadLogs}
                  onClick={() => void openLog(l.name)}
                  sx={{ fontFamily: 'monospace', fontSize: 11 }}
                />
              ))}
            </Stack>
          )}
          <OperationStatus active={mayReadLogs && Boolean(readingLog)} label={`Reading ${readingLog ?? ''}`} />
          {mayReadLogs && logError && (
            <Alert severity="warning" variant="outlined" sx={{ mt: 1.5 }}>
              {logError}
            </Alert>
          )}
          {mayReadLogs && log && (
            <>
              <Divider sx={{ my: 1.5 }} />
              <Box
                sx={{
                  maxHeight: 420,
                  overflow: 'auto',
                  p: 1.5,
                  borderRadius: 1,
                  bgcolor: (theme: any) => alpha(theme.palette.text.primary, 0.04),
                }}
              >
                <Typography variant="caption" sx={{ fontFamily: 'monospace', whiteSpace: 'pre', display: 'block' }}>
                  {log.tail}
                </Typography>
              </Box>
            </>
          )}
        </CardContent>
      </Card>

      <Can permission="OmnitronProject.startStack"><DeployReleaseDialog
        open={deployOpen}
        onClose={() => setDeployOpen(false)}
        project={release.project}
        release={release as ReleaseSummary}
      /></Can>
    </Stack>
  );
}
