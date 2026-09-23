/**
 * Releases — what this master has built, and what is building now.
 *
 * The page answers three questions in one screen, in the order an operator
 * asks them: is a build running and how far has it got; what can be deployed
 * right now and what is wrong with the rest; and which release each stack is
 * actually carrying.
 *
 * The last of those comes from the audit trail rather than from the stacks
 * themselves, and the page says so: the running state lives in the daemon's
 * memory and a restart empties it, while `stack.start` rows do not. «Last
 * deployed» is a fact about what was done; «running» would be a claim the
 * console cannot support.
 */

import { useCallback, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { Alert, AdminDataTable, Breadcrumbs, type ColumnDef } from '@omnitron-dev/prism';

import type { BuildRecord, ReleaseDeploymentDto, ReleaseSummary } from '@omnitron-dev/omnitron/dto/services';
import { pruneBlindness, stacksByRelease, type DeploymentsAnswer } from '@omnitron-dev/omnitron/release-reading';
import { DeleteIcon, DeployIcon, PlusIcon, RefreshIcon } from 'src/assets/icons';
import { DeployReleaseDialog } from 'src/components/deploy-release-dialog';
import { ReleaseBuildPanel } from 'src/components/release-build-panel';
import { CommitPair, GateCount, GateStrip, bytes, loadWords, ranLoaded, when } from 'src/components/release-bits';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { releases as releaseRpc } from 'src/netron/client';
import { releaseApi, type ReleasePreflightView } from 'src/netron/release-wire';
import { useActiveProject } from 'src/stores/project.store';
import { useAuthStore } from 'src/auth/store';

import BuildReleaseDialog from './build-release-dialog';
import PruneReleasesDialog from './prune-releases-dialog';

interface PageData {
  releases: ReleaseSummary[];
  root: string;
  builds: BuildRecord[];
  preflight: ReleasePreflightView | null;
  /** Which release each stack runs — or why that cannot be said, which is not «none». */
  deployments: DeploymentsAnswer;
  /** What could not be read, when the rest could. */
  partial: string | null;
}

/**
 * Four questions in one poll.
 *
 * Settled rather than all-or-nothing: a master whose audit database is down
 * still has releases on its disk, and a page that blanked the table because
 * one of four calls failed would be hiding what it does know.
 */
async function loadPage(): Promise<PageData> {
  const [list, builds, preflight, deployments] = await Promise.allSettled([
    releaseApi.list(),
    releaseApi.builds(),
    releaseApi.preflight(),
    releaseApi.deployments(200),
  ]);
  const failures: string[] = [];
  if (list.status === 'rejected') failures.push(`releases: ${(list.reason as Error)?.message ?? 'unavailable'}`);
  if (builds.status === 'rejected') failures.push(`builds: ${(builds.reason as Error)?.message ?? 'unavailable'}`);
  if (preflight.status === 'rejected') failures.push(`preflight: ${(preflight.reason as Error)?.message ?? 'unavailable'}`);
  if (deployments.status === 'rejected') failures.push(`deployments: ${(deployments.reason as Error)?.message ?? 'unavailable'}`);
  if (list.status === 'rejected') throw list.reason;
  return {
    releases: list.value.releases,
    root: list.value.root,
    builds: builds.status === 'fulfilled' ? builds.value : [],
    preflight: preflight.status === 'fulfilled' ? preflight.value : null,
    deployments:
      deployments.status === 'fulfilled'
        ? deployments.value
        : { known: false, why: `the daemon could not say which release a stack runs: ${(deployments.reason as Error)?.message ?? 'unavailable'}` },
    partial: failures.length > 0 ? failures.join(' · ') : null,
  };
}

export default function ReleasesPage() {
  const activeProject = useActiveProject();
  const role = useAuthStore((s) => s.user?.role);
  const [buildOpen, setBuildOpen] = useState(false);
  const [pruneOpen, setPruneOpen] = useState(false);
  const [deployTarget, setDeployTarget] = useState<ReleaseSummary | null>(null);
  /**
   * The build this page just started.
   *
   * Held for the seconds before a poll has seen it. Without it the panel
   * appeared only on the next twenty-second refresh — measured: the build
   * started, the daemon logged it, and the page showed nothing at all, which
   * reads as «the button did not work».
   */
  const [justStarted, setJustStarted] = useState<BuildRecord | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [onlyActiveProject, setOnlyActiveProject] = useState(true);

  const { data, loading, error, refresh } = usePolledResource(loadPage, { intervalMs: 20_000 });

  const building = (data?.builds ?? []).some((b) => b.state === 'running') || justStarted !== null;
  // Three seconds while something is building, twenty when nothing is: the
  // phase and the percent are the only readings on this page that change on
  // their own, and they change every few seconds.
  const live = usePolledResource(async () => releaseApi.builds(), { intervalMs: 3_000, enabled: building });
  const polled = live.data ?? data?.builds ?? [];
  const builds =
    justStarted && !polled.some((b) => b.buildId === justStarted.buildId) ? [justStarted, ...polled] : polled;

  // Same reason as the stacks list in the build dialog: `?? []` is a new
  // array each render, and the filter below is keyed on it.
  const all = useMemo(() => data?.releases ?? [], [data?.releases]);
  const rows = useMemo(
    () => (onlyActiveProject && activeProject ? all.filter((r) => r.project === activeProject) : all),
    [all, onlyActiveProject, activeProject],
  );

  /** Which stacks last deployed each release — «test», «prod» on the row. */
  const deployedBy = useMemo(
    () => (data?.deployments.known ? stacksByRelease(data.deployments.deployments) : new Map<string, ReleaseDeploymentDto[]>()),
    [data?.deployments],
  );

  const handleStop = useCallback(
    async (buildId: string) => {
      try {
        await releaseRpc.stopBuild({ buildId });
        await live.refresh();
      } catch (err) {
        setActionError((err as Error).message);
      }
    },
    [live],
  );

  /**
   * Five columns, by what an operator decides with them.
   *
   * There were eight, and at a laptop's width — 1200 px, a 280 px sidebar —
   * they overflowed into a horizontal scroll with «Deploy…» pressed against
   * the table's edge. Where a release is deployed now sits beside its id,
   * because that is the first thing looked for; what it carries — apps,
   * statics, size — is one column.
   */
  const columns: ColumnDef<ReleaseSummary>[] = [
    {
      key: 'id',
      header: 'Release',
      render: (r) => {
        const targets = deployedBy.get(r.id) ?? [];
        return (
          <Stack spacing={0.5}>
            <Typography
              component={RouterLink}
              to={`/releases/${r.id}`}
              variant="body2"
              sx={{ fontFamily: 'monospace', fontWeight: 600, textDecoration: 'none', color: 'text.primary', wordBreak: 'break-all', '&:hover': { color: 'primary.main' } }}
            >
              {r.id}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <CommitPair projectCommit={r.projectCommit} omniCommit={r.omniCommit} onRemote={r.onRemote} project={r.project} />
              {!r.complete && (
                <Tooltip title="This directory holds no manifest: the build did not finish. Its logs are still there." arrow>
                  <Chip label="unfinished" size="small" color="warning" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                </Tooltip>
              )}
              {targets.map((t) => (
                <Tooltip
                  key={`${t.project}/${t.stack}`}
                  title={`Last deployed to ${t.stack} ${when(t.at)} · ${t.source ?? 'unknown'}`}
                  arrow
                >
                  <Chip label={`on ${t.stack}`} size="small" color="success" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                </Tooltip>
              ))}
            </Stack>
          </Stack>
        );
      },
    },
    {
      key: 'built',
      header: 'Built',
      render: (r) => (
        <Stack spacing={0.25} sx={{ maxWidth: 170 }}>
          <Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>
            {when(r.builtAt)}
          </Typography>
          <Tooltip title={r.builtBy ?? ''} arrow>
            <Typography variant="caption" noWrap sx={{ color: 'text.secondary', display: 'block' }}>
              {r.builtBy ?? '—'}
            </Typography>
          </Tooltip>
        </Stack>
      ),
    },
    {
      key: 'gates',
      header: 'Gates',
      render: (r) => (
        <Stack spacing={0.5}>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
            <GateCount release={r} />
            {r.machine && ranLoaded(r.machine) && (
              <Tooltip
                title={`The machine was carrying more than its cores while the gates ran — ${loadWords(r.machine)}. A red gate here is evidence about the machine before it is evidence about the code.`}
                arrow
              >
                <Chip label="loaded" size="small" color="warning" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
              </Tooltip>
            )}
          </Stack>
          <GateStrip gates={r.gateList} size={8} columns={7} />
          {r.verified.map((v) => (
            <Tooltip key={v.stack} title={`Probes ${v.stack} ran against this release while carrying it — measured ${when(v.at)}`} arrow>
              <Typography
                variant="caption"
                sx={{ color: v.passed === v.total ? 'success.main' : 'warning.main', fontFamily: 'monospace', whiteSpace: 'nowrap' }}
              >
                verified on {v.stack}: {v.passed}/{v.total}
              </Typography>
            </Tooltip>
          ))}
        </Stack>
      ),
    },
    {
      key: 'carries',
      header: 'Carries',
      render: (r) => (
        <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
          <Tooltip title={r.artifacts.apps.join(', ') || 'none'} arrow>
            <Typography variant="body2" sx={{ whiteSpace: 'nowrap', color: r.complete ? 'text.primary' : 'text.disabled' }}>
              {/* An unfinished build packed nothing because it did not get
                  that far — «0 apps» would read as a build that produced none. */}
              {r.complete ? `${r.artifacts.count} app${r.artifacts.count === 1 ? '' : 's'}` : '—'}
              {r.artifacts.failed.length > 0 && (
                <Typography component="span" variant="caption" sx={{ color: 'error.main', ml: 0.75 }}>
                  {r.artifacts.failed.length} did not build
                </Typography>
              )}
            </Typography>
          </Tooltip>
          {r.statics && (
            <Tooltip title={`Static bundle built with ${r.statics.stack}'s environment — ${r.statics.files} files, ${bytes(r.statics.bytes)}`} arrow>
              <Chip label={`statics: ${r.statics.stack}`} size="small" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
            </Tooltip>
          )}
          <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
            {bytes(r.bytes)}
            {r.keptSource && (
              <Tooltip title="The build's two clones are still on disk — kept on purpose, or left by a build that failed. They are not counted in this size." arrow>
                <Box component="span" sx={{ color: 'warning.main', ml: 0.75 }}>
                  + clones
                </Box>
              </Tooltip>
            )}
          </Typography>
        </Stack>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<DeployIcon />}
            disabled={!r.complete}
            onClick={() => setDeployTarget(r)}
            sx={{ whiteSpace: 'nowrap' }}
          >
            Deploy…
          </Button>
        </Stack>
      ),
    },
  ];

  const pageRows = rows.slice(page * pageSize, page * pageSize + pageSize);
  const canBuild = data?.preflight?.canBuild !== false;
  const totalBytes = all.reduce((sum, r) => sum + r.bytes, 0);

  return (
    <Stack spacing={3}>
      <Breadcrumbs
        links={[{ name: 'Releases' }]}
        action={
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <IconButton size="small" onClick={() => void refresh()} title="Refresh">
              <RefreshIcon />
            </IconButton>
            {role === 'admin' && (
              <Button size="small" startIcon={<DeleteIcon />} onClick={() => setPruneOpen(true)}>
                Prune…
              </Button>
            )}
            <Tooltip title={canBuild ? '' : 'This master cannot run a build — see the banner'} arrow>
              <span>
                <Button variant="contained" size="small" startIcon={<PlusIcon />} disabled={!canBuild} onClick={() => setBuildOpen(true)}>
                  Build
                </Button>
              </span>
            </Tooltip>
          </Stack>
        }
      />

      {data?.preflight && !data.preflight.canBuild && (
        <Alert severity="error" variant="outlined">
          This master cannot run a release build: <strong>{data.preflight.missingTools.join(', ')}</strong>{' '}
          {data.preflight.missingTools.length === 1 ? 'is' : 'are'} not on the daemon&apos;s PATH. A daemon started by
          launchd has the system PATH, not a shell&apos;s. It looked in: {data.preflight.path.slice(0, 6).join(', ')}
          {data.preflight.path.length > 6 ? ', …' : ''}
        </Alert>
      )}

      {actionError && (
        <Alert closable severity="warning" variant="outlined" onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      {data?.partial && (
        <Alert severity="warning" variant="outlined">
          Part of this page could not be read — {data.partial}
        </Alert>
      )}

      {data && !data.deployments.known && (
        <Alert severity="warning" variant="outlined">
          Which release each stack runs is unknown — {data.deployments.why}. No release below is marked as deployed
          for that reason, not because none is, and pruning is refused until it can be told.
        </Alert>
      )}

      {builds.length > 0 && (
        <Stack spacing={1.5}>
          {builds.slice(0, 3).map((record) => (
            <ReleaseBuildPanel
              key={record.buildId}
              record={record}
              onStop={handleStop}
              onDeploy={(releaseId) => {
                const summary = all.find((r) => r.id === releaseId);
                if (summary) setDeployTarget(summary);
                else void refresh();
              }}
            />
          ))}
        </Stack>
      )}

      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
          {data?.root ?? ''}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {all.length} release{all.length === 1 ? '' : 's'}, {bytes(totalBytes)} on disk
        </Typography>
        <Box sx={{ flex: 1 }} />
        {activeProject && (
          <Chip
            size="small"
            variant={onlyActiveProject ? 'filled' : 'outlined'}
            label={onlyActiveProject ? `only ${activeProject}` : 'all projects'}
            onClick={() => setOnlyActiveProject((v) => !v)}
            sx={{ height: 22, fontSize: 11 }}
          />
        )}
      </Stack>

      <AdminDataTable<ReleaseSummary>
        columns={columns}
        data={pageRows}
        total={rows.length}
        loading={loading}
        loadError={error ?? null}
        emptyMessage="Nothing has been built on this master yet"
        rowKey={(r) => r.id}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(0);
        }}
        dense
      />

      <BuildReleaseDialog
        open={buildOpen}
        onClose={() => setBuildOpen(false)}
        defaultProject={activeProject}
        preflight={data?.preflight ?? null}
        onStarted={(record) => {
          setJustStarted(record);
          void live.refresh().then(() => refresh());
        }}
      />

      <PruneReleasesDialog
        open={pruneOpen}
        onClose={() => setPruneOpen(false)}
        protect={[...deployedBy.keys()]}
        blind={data ? pruneBlindness(data.deployments) : 'the release list has not been read yet'}
        onPruned={() => void refresh()}
      />

      <DeployReleaseDialog
        open={deployTarget !== null}
        onClose={() => setDeployTarget(null)}
        project={deployTarget?.project ?? activeProject ?? ''}
        release={deployTarget}
      />
    </Stack>
  );
}
