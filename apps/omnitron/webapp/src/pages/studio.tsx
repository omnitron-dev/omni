import { useWorkspace, workspaceHref } from 'src/routes/workspace';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link as RouterLink, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box,
  Button,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { useSnackbar } from '@omnitron-dev/prism/components/snackbar';
import {
  STUDIO_ROLES,
  STUDIO_ROLE_POLICY,
  selectStudioModel,
  studioRoleRequirements,
  type StudioCostTier,
  type StudioPreferences,
  type StudioProvider,
  type StudioRole,
  type StudioSend,
  type StudioThread,
  type StudioThreadCursor,
} from '@omnitron-dev/omnitron/dto/services';
import { Breadcrumbs } from 'src/components/page-breadcrumbs';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { studio } from 'src/netron/client';
import { useAccess } from 'src/auth/access';
import { attachStudioText } from 'src/utils/studio-message';
import { StudioTurnCard } from 'src/components/studio-turn';
import { StudioTeamEditor } from 'src/components/studio-team-editor';
import { StudioConnectorDetails } from 'src/components/studio-connector-details';
import { studioProviderName, studioProviderOptions } from 'src/utils/studio-provider';
import { StudioTeamRoom, studioSections, type StudioSection } from 'src/components/studio-team-room';
import { PlusIcon } from 'src/assets/icons';

const budgetLabels = { economy: 'Economy', standard: 'Standard', premium: 'Premium' };
const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));
const plain = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } as const;
export default function StudioPage() {
  const { project, stack } = useWorkspace();
  const { snapshot } = useAccess();
  return (
    <StudioWorkspace
      key={JSON.stringify([snapshot?.userId, project, stack])}
      project={project}
      stack={project ? stack : null}
    />
  );
}

function StudioWorkspace({ project, stack }: { project: string | null; stack: string | null }) {
  const { can } = useAccess();
  const navigate = useNavigate();
  const notify = useSnackbar();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const selected = params.get('team') || null;
  const section = studioSections.find((value) => value === params.get('tab')) ?? 'chat';
  const includeTasks = section === 'tasks';
  const setSection = (value: StudioSection) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value === 'chat') next.delete('tab');
        else next.set('tab', value);
        return next;
      },
      { preventScrollReset: true }
    );
  const [draftTeamId, setDraftTeamId] = useState(() => crypto.randomUUID());
  const [editingPolicy, setEditingPolicy] = useState(false);
  const [individual, setIndividual] = useState(false);
  const canCreateTeam = can('OmnitronStudio.createTeam');
  const canReadThread = can('OmnitronStudio.thread');
  const select = (id: string | null) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (id) next.set('team', id);
      else next.delete('team');
      next.delete('before');
      next.delete('tab');
      return next;
    });
  const teamHref = (item: StudioThread) => {
    const next = new URLSearchParams(params);
    next.set('team', item.id);
    if (item.id !== selected) {
      next.delete('before');
      next.delete('tab');
    }
    return workspaceHref({ project, stack: item.stack ?? null }, '/studio?' + next + location.hash);
  };
  const [provider, setProvider] = useState<StudioProvider>('codex');
  const [model, setModel] = useState('@automatic');
  const [tier, setTier] = useState<StudioCostTier>('economy');
  const [role, setRole] = useState<StudioRole>('analyst');
  const [interview, setInterview] = useState(false);
  const messageInput = useRef<HTMLTextAreaElement>(null);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [listBefore, setListBefore] = useState<StudioThreadCursor>();
  const turnBefore = selected ? (params.get('before') ?? undefined) : undefined;
  const setTurnBefore = (id?: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (id) next.set('before', id);
      else next.delete('before');
      return next;
    });
  const [following, setFollowing] = useState<string | null>(null);
  const currentThread = useRef(selected);
  currentThread.current = selected;
  const uncertain = useRef<StudioSend | null>(null);
  const workspace = usePolledResource(
    () => studio.workspace({ project, ...(stack && { stack }), ...(listBefore && { before: listBefore }) }),
    {
      resourceKey: JSON.stringify([project, stack, listBefore]),
      paused: !!listBefore,
      intervalMs: 10_000,
    }
  );
  const threads = workspace.data?.threads ?? [];
  const latestChange = threads.find((entry) => entry.id === selected)?.updatedAt;
  const history = usePolledResource(
    async () => {
      const result = await studio.thread({
        project,
        threadId: selected!,
        includeTasks,
        ...(turnBefore && { before: turnBefore }),
      });
      const running =
        result.team?.hasActiveTurns ??
        result.turns.some((item) => item.status === 'queued' || item.status === 'running');
      if (!turnBefore && currentThread.current === selected) {
        if (running) setFollowing(selected);
        else setFollowing((current) => (current === selected ? null : current));
      }
      return { ...result, includesTasks: includeTasks };
    },
    {
      resourceKey: JSON.stringify([selected, turnBefore]),
      enabled: !!selected && canReadThread,
      paused: !!turnBefore || following !== selected,
      intervalMs: 1600,
    }
  );
  const observed = useRef({ selected, latestChange, includeTasks });
  const refreshHistory = history.refresh;
  useEffect(() => {
    const previous = observed.current;
    observed.current = { selected, latestChange, includeTasks };
    if (
      selected &&
      previous.selected === selected &&
      (includeTasks !== previous.includeTasks ||
        (!turnBefore &&
          latestChange !== undefined &&
          previous.latestChange !== undefined &&
          latestChange !== previous.latestChange))
    )
      void refreshHistory();
  }, [selected, turnBefore, latestChange, includeTasks, refreshHistory]);
  const thread = history.data?.thread;
  const turns = history.data?.turns ?? [];
  const last = turns.at(-1);
  const active = !turnBefore && (last?.status === 'queued' || last?.status === 'running');
  const currentProvider = thread?.provider ?? provider;
  const catalog = workspace.data?.catalogs.find((c) => c.provider === currentProvider);
  const frozen = !!selected;
  const preferences: StudioPreferences = thread?.assignment.preferences ?? {
    role,
    ...(interview && { purpose: 'project-interview' }),
    result: STUDIO_ROLE_POLICY[role].result,
    requirements: studioRoleRequirements(
      role,
      model === '@automatic' ? { maxCostTier: tier } : {},
      model !== '@automatic'
    ),
    ...(model && model !== '@automatic' && { model }),
  };
  const choice =
    catalog && (thread || model)
      ? selectStudioModel(catalog, {
          provider: currentProvider,
          connector: catalog.connector,
          requirements: preferences.requirements,
          ...(preferences.model && { model: preferences.model }),
          ...(thread && { previous: thread.assignment.selection }),
        })
      : null;
  const ready =
    !busy && !active && !!prompt.trim() && choice?.ok && (!selected || (thread && last?.status === 'completed'));
  const resetDraft = () => {
    setDraftTeamId(crypto.randomUUID());
    setEditingPolicy(false);
    setIndividual(false);
    setInterview(false);
    setPrompt('');
    setError('');
    uncertain.current = null;
  };
  const action = async (op: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await op();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  };
  const send = () =>
    action(async () => {
      const request: StudioSend = uncertain.current ?? {
        project,
        ...(stack && { stack }),
        threadId: selected ?? crypto.randomUUID(),
        turnId: crypto.randomUUID(),
        after: last?.id ?? null,
        prompt,
        provider: currentProvider,
        preferences,
      };
      uncertain.current = request;
      const receipt = await studio.send(request);
      uncertain.current = null;
      if (selected !== receipt.threadId) select(receipt.threadId);
      setListBefore(undefined);
      setPrompt('');
      await workspace.refresh();
      if (selected === receipt.threadId) await history.refresh();
    });
  const attach = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      setPrompt(await attachStudioText(file, prompt));
      setError('');
    } catch (e) {
      setError(describe(e));
    }
  };
  if (thread && (thread.stack ?? null) !== stack) return <Navigate replace to={teamHref(thread)} />;
  return (
    <Stack spacing={2.5} sx={{ minWidth: 0 }}>
      <Breadcrumbs
        links={
          thread
            ? [{ name: 'Agent Studio', href: workspaceHref({ project, stack }, '/studio') }, { name: thread.title }]
            : [{ name: 'Agent Studio' }]
        }
        action={
          canCreateTeam || can('OmnitronStudio.send') ? (
            <Button
              size="small"
              variant="outlined"
              startIcon={<PlusIcon />}
              aria-label={canCreateTeam ? 'New team' : 'New conversation'}
              onClick={() => {
                resetDraft();
                if (selected) select(null);
              }}
              disabled={busy || !!uncertain.current}
            >
              {canCreateTeam ? 'New team' : 'New conversation'}
            </Button>
          ) : undefined
        }
      />
      {(error || workspace.error || history.error) && (
        <Alert severity="error">{error || workspace.error || history.error}</Alert>
      )}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'minmax(190px,240px) minmax(0,1fr)' },
          gap: 2,
          alignItems: 'start',
        }}
      >
        <Paper variant="outlined" sx={{ p: 1.5, minWidth: 0, maxHeight: { xs: 200, md: '70vh' }, overflow: 'auto' }}>
          <Typography variant="overline" color="text.secondary">
            {project ?? 'Project planning'}
            {stack && ' / ' + stack}
          </Typography>
          <List dense aria-label={canCreateTeam ? 'Teams and conversations' : 'Conversations'} disablePadding>
            {threads.map((t) => (
              <ListItemButton
                key={t.id}
                selected={selected === t.id}
                component={RouterLink}
                to={teamHref(t)}
                onClick={(event) => {
                  if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) resetDraft();
                }}
                disabled={!canReadThread || busy || !!uncertain.current}
              >
                <ListItemText
                  primary={t.title}
                  secondary={studioProviderName(t.provider) + ' · ' + t.assignment.preferences.role}
                  slotProps={{ primary: { noWrap: true } }}
                />
              </ListItemButton>
            ))}
          </List>
          {!threads.length && (
            <Typography variant="body2" color="text.secondary">
              No conversations yet.
            </Typography>
          )}
          {(listBefore || workspace.data?.older) && (
            <Stack direction="row" spacing={1}>
              {listBefore && (
                <Button size="small" onClick={() => setListBefore(undefined)}>
                  Latest
                </Button>
              )}
              {workspace.data?.older && (
                <Button size="small" onClick={() => setListBefore(workspace.data!.older!)}>
                  Older conversations
                </Button>
              )}
            </Stack>
          )}
        </Paper>
        <Paper variant="outlined" sx={{ minWidth: 0, p: { xs: 1.75, sm: 3 } }}>
          <Stack spacing={2}>
            <Typography variant="h6" component={thread ? 'p' : 'h2'} sx={plain}>
              {thread?.title ??
                (selected
                  ? 'Conversation'
                  : interview
                    ? 'Project interview'
                    : canCreateTeam && !individual
                      ? 'New team'
                      : 'New conversation')}
            </Typography>
            {selected && !canReadThread ? (
              <Alert severity="info">Reading this conversation requires access to Studio history.</Alert>
            ) : selected && history.loading && !history.data ? (
              <Typography role="status">Reading conversation…</Typography>
            ) : !selected && !canCreateTeam && !can('OmnitronStudio.send') ? (
              <Typography variant="body2">Choose a conversation from the list.</Typography>
            ) : !selected && canCreateTeam && !individual && !interview ? (
              <>
                <StudioTeamEditor
                  key={draftTeamId}
                  mode="create"
                  room={{ project, threadId: draftTeamId }}
                  stack={stack}
                  catalogs={workspace.data?.catalogs ?? []}
                  account={workspace.data?.account ?? ''}
                  policy={null}
                  onSaved={async (id) => {
                    select(id);
                    setListBefore(undefined);
                    await workspace.refresh();
                  }}
                />
                {can('OmnitronStudio.send') && (
                  <Button size="small" sx={{ alignSelf: 'start' }} onClick={() => setIndividual(true)}>
                    Individual conversation
                  </Button>
                )}
                {!project && can('OmnitronStudio.send') && (
                  <Button
                    size="small"
                    sx={{ alignSelf: 'start' }}
                    onClick={() => {
                      setInterview(true);
                      setRole('analyst');
                    }}
                  >
                    Plan a project
                  </Button>
                )}
              </>
            ) : history.data?.team?.policy && thread ? (
              <>
                {(turnBefore || history.data.beforeTurn) && (
                  <Stack direction="row" spacing={1}>
                    {history.data.beforeTurn && (
                      <Button size="small" onClick={() => setTurnBefore(history.data!.beforeTurn!)}>
                        Earlier messages
                      </Button>
                    )}
                    {turnBefore && (
                      <Button size="small" onClick={() => setTurnBefore(undefined)}>
                        Latest messages
                      </Button>
                    )}
                  </Stack>
                )}
                <StudioTeamRoom
                  key={thread.id}
                  room={{ project, threadId: thread.id }}
                  history={history.data}
                  section={section}
                  setSection={setSection}
                  tasksState={history.data.includesTasks ? 'ready' : history.error ? 'unavailable' : 'loading'}
                  catalogs={workspace.data?.catalogs ?? []}
                  account={workspace.data?.account ?? ''}
                  latest={!turnBefore}
                  refresh={async () => {
                    await Promise.all([history.refresh(), workspace.refresh()]);
                  }}
                />
              </>
            ) : (
              <>
                {selected &&
                  thread &&
                  history.data?.team &&
                  can('OmnitronStudio.configureTeam') &&
                  (editingPolicy ? (
                    <StudioTeamEditor
                      mode="policy"
                      leadProvider={thread.provider}
                      room={{ project, threadId: thread.id }}
                      stack={thread.stack}
                      catalogs={workspace.data?.catalogs ?? []}
                      account={workspace.data?.account ?? ''}
                      policy={null}
                      onClose={() => setEditingPolicy(false)}
                      onSaved={async () => {
                        await history.refresh();
                        setEditingPolicy(false);
                      }}
                    />
                  ) : (
                    <Button size="small" sx={{ alignSelf: 'start' }} onClick={() => setEditingPolicy(true)}>
                      Enable team
                    </Button>
                  ))}
                {!frozen && (
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1.5}
                    sx={{ '& > *': { minWidth: 0, flex: 1 } }}
                  >
                    <TextField
                      label="Adapter"
                      size="small"
                      select
                      value={provider}
                      onChange={(e) => {
                        setProvider(e.target.value as StudioProvider);
                        setModel('@automatic');
                      }}
                    >
                      {studioProviderOptions(workspace.data?.catalogs ?? [], [provider]).map((v) => (
                        <MenuItem key={v} value={v} sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                          {studioProviderName(v)}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      label="Responsibility"
                      disabled={interview}
                      size="small"
                      select
                      value={role}
                      onChange={(e) => setRole(e.target.value as StudioRole)}
                    >
                      {STUDIO_ROLES.map((v) => (
                        <MenuItem key={v} value={v}>
                          {v}
                        </MenuItem>
                      ))}
                    </TextField>
                    {!!catalog && (
                      <TextField
                        label="Model"
                        size="small"
                        select
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                      >
                        <MenuItem value="@automatic">Automatic · budgeted</MenuItem>
                        {catalog.models.map((m) => (
                          <MenuItem key={m.id} value={m.id}>
                            {m.label}
                          </MenuItem>
                        ))}
                      </TextField>
                    )}
                  </Stack>
                )}
                {model === '@automatic' && !frozen && (
                  <TextField
                    label="Maximum cost tier"
                    select
                    size="small"
                    value={tier}
                    onChange={(e) => setTier(e.target.value as StudioCostTier)}
                  >
                    {Object.entries(budgetLabels).map(([id, label]) => (
                      <MenuItem value={id} key={id}>
                        {label}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
                {choice && !choice.ok && <Alert severity="warning">{choice.message}</Alert>}
                {(thread || choice?.ok) && (
                  <Typography variant="caption" color="text.secondary">
                    {thread
                      ? thread.assignment.preferences.role + ' · ' + thread.assignment.selection.model
                      : choice?.ok
                        ? choice.selection.model + ' · ' + choice.selection.basis
                        : ''}
                    {thread?.stack && ' · ' + thread.stack}
                  </Typography>
                )}
                {workspace.data && (!catalog || connecting) && (
                  <StudioConnectorDetails
                    project={project}
                    account={workspace.data.account}
                    provider={currentProvider}
                    connected={Boolean(catalog)}
                    onCopy={(command) =>
                      navigator.clipboard
                        .writeText(command)
                        .then(() => notify.success('Command copied'))
                        .catch((e) => setError(describe(e)))
                    }
                  />
                )}
                {catalog && (
                  <Button size="small" sx={{ alignSelf: 'start' }} onClick={() => setConnecting(!connecting)}>
                    {connecting ? 'Hide connector' : 'Connection details'}
                  </Button>
                )}
                {(turnBefore || history.data?.beforeTurn) && (
                  <Stack direction="row" spacing={1}>
                    {history.data?.beforeTurn && (
                      <Button size="small" onClick={() => setTurnBefore(history.data!.beforeTurn!)}>
                        Earlier turns
                      </Button>
                    )}
                    {turnBefore && (
                      <Button size="small" onClick={() => setTurnBefore(undefined)}>
                        Latest turns
                      </Button>
                    )}
                  </Stack>
                )}
                {turns.map((t) => (
                  <StudioTurnCard
                    key={t.id}
                    turn={t}
                    onStarter={
                      preferences.purpose === 'project-interview' &&
                      can('OmnitronProject.reviewProjectCreation') &&
                      can('OmnitronProject.createProject')
                        ? (href) => navigate(href)
                        : undefined
                    }
                    onReview={
                      can('OmnitronStudio.review')
                        ? (outcome, note, previous) =>
                            action(async () => {
                              await studio.review({
                                project,
                                threadId: selected!,
                                turnId: t.id,
                                outcome,
                                note,
                                previous,
                              });
                              await history.refresh();
                            })
                        : undefined
                    }
                  />
                ))}
                {active ? (
                  <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="body2" role="status">
                      {last.status === 'queued' ? 'Waiting for the connector' : 'Agent is responding…'}
                    </Typography>
                    {can('OmnitronStudio.cancel') && (
                      <Button
                        size="small"
                        onClick={() =>
                          action(async () => {
                            await studio.cancel({ project, threadId: selected!, turnId: last.id });
                            await history.refresh();
                          })
                        }
                      >
                        Stop turn
                      </Button>
                    )}
                  </Stack>
                ) : !turnBefore && last && last.status !== 'completed' ? (
                  <Alert severity="info">Start a new conversation to continue after this turn.</Alert>
                ) : null}
                {can('OmnitronStudio.send') &&
                  !turnBefore &&
                  (!selected || (thread && last?.status === 'completed')) && (
                    <>
                      {!selected && (
                        <Button
                          size="small"
                          sx={{ alignSelf: 'start' }}
                          disabled={busy || !!uncertain.current}
                          onClick={() => {
                            setInterview(!interview);
                            if (!interview) setRole('analyst');
                            messageInput.current?.focus();
                          }}
                        >
                          {interview ? 'Switch to conversation' : 'Plan a project'}
                        </Button>
                      )}
                      <TextField
                        multiline
                        minRows={3}
                        maxRows={12}
                        label="Message"
                        inputRef={messageInput}
                        placeholder={interview && !thread ? 'What would you like the project to do?' : undefined}
                        value={prompt}
                        disabled={busy || !!uncertain.current}
                        onChange={(e) => setPrompt(e.target.value)}
                        helperText="Review the text before sending it to the selected provider. File paths and account IDs are kept local."
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && ready) {
                            e.preventDefault();
                            void send();
                          }
                        }}
                      />
                      <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                        <Button component="label" size="small" disabled={busy || !!uncertain.current}>
                          Attach text
                          <input hidden type="file" onChange={attach} />
                        </Button>
                        {!!uncertain.current && (
                          <Button
                            disabled={busy}
                            onClick={() =>
                              action(async () => {
                                const pending = uncertain.current!;
                                const { status } = await studio.cancel({
                                  project,
                                  threadId: pending.threadId,
                                  turnId: pending.turnId,
                                });
                                uncertain.current = null;
                                if (status === 'withdrawn') {
                                  notify.info('Request withdrawn. The draft is ready to edit.');
                                } else {
                                  if (selected !== pending.threadId) select(pending.threadId);
                                  setPrompt('');
                                  await workspace.refresh();
                                  if (selected === pending.threadId) await history.refresh();
                                }
                              })
                            }
                          >
                            Withdraw request
                          </Button>
                        )}
                        <Button
                          variant="contained"
                          size="small"
                          disabled={!(ready || (uncertain.current && !busy))}
                          onClick={send}
                        >
                          {uncertain.current && !busy ? 'Retry same request' : 'Send message'}
                        </Button>
                      </Stack>
                    </>
                  )}
              </>
            )}
          </Stack>
        </Paper>
      </Box>
    </Stack>
  );
}
