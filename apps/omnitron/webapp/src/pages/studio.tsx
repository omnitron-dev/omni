import { memo, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Chip,
  Divider,
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
import { Markdown } from '@omnitron-dev/prism/components/content-renderer';
import { useSnackbar } from '@omnitron-dev/prism/components/snackbar';
import {
  STUDIO_PROVIDERS,
  STUDIO_ROLES,
  STUDIO_ROLE_POLICY,
  readProjectSuggestion,
  selectStudioModel,
  studioRoleRequirements,
  type StudioCostTier,
  type StudioPreferences,
  type StudioProvider,
  type StudioRole,
  type StudioSend,
  type StudioTurn,
  type StudioThreadCursor,
} from '@omnitron-dev/omnitron/dto/services';
import { Breadcrumbs } from 'src/components/page-breadcrumbs';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { studio } from 'src/netron/client';
import { useProjectStore } from 'src/stores/project.store';
import { useAccess } from 'src/auth/access';
import { PlusIcon } from 'src/assets/icons';

const labels = { codex: 'Codex', agy: 'Antigravity' };
const ResponseMarkdown = memo(Markdown);
const budgetLabels = { economy: 'Economy', standard: 'Standard', premium: 'Premium' };
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));
const plain = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } as const;
const blocked = {
  authorization: 'Authorization changed before delivery.',
  'model-changed': 'The approved model or its cost changed. Review the current catalog.',
  'scope-unavailable': 'The assigned stack could not be verified before dispatch.',
  disconnected: 'The connector disconnected. The outcome of an in-flight request may be unknown.',
  provider: 'The provider could not finish the turn.',
  protocol: 'The provider returned an incomplete or incompatible response.',
  'sign-in': 'Sign in to the local provider CLI and reconnect.',
  timeout: 'The provider exceeded the turn deadline.',
};

function starterLink(answer: string) {
  const n = readProjectSuggestion(answer);
  return n
    ? '/projects?' +
        new URLSearchParams({
          create: '1',
          automation: n.automation ? '1' : '0',
          persistence: n.persistence,
          service: n.service,
        })
    : null;
}

export default function StudioPage() {
  const project = useProjectStore((s) => s.activeProject);
  const stack = useProjectStore((s) => s.activeStack);
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
  const [selected, setSelected] = useState<string | null>(null);
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
  const [turnBefore, setTurnBefore] = useState<string>();
  const [following, setFollowing] = useState<string | null>(null);
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
      const result = await studio.thread({ project, threadId: selected!, ...(turnBefore && { before: turnBefore }) });
      const status = result.turns.at(-1)?.status;
      if (!turnBefore) {
        if (status === 'queued' || status === 'running') setFollowing(selected);
        else setFollowing((current) => (current === selected ? null : current));
      }
      return result;
    },
    {
      resourceKey: JSON.stringify([selected, turnBefore]),
      enabled: !!selected,
      paused: !!turnBefore || following !== selected,
      intervalMs: 1600,
    }
  );
  const observed = useRef({ selected, latestChange });
  const refreshHistory = history.refresh;
  useEffect(() => {
    const previous = observed.current;
    observed.current = { selected, latestChange };
    if (
      selected &&
      !turnBefore &&
      previous.selected === selected &&
      latestChange !== undefined &&
      previous.latestChange !== undefined &&
      latestChange !== previous.latestChange
    )
      void refreshHistory();
  }, [selected, turnBefore, latestChange, refreshHistory]);
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
  const reset = (id: string | null) => {
    setSelected(id);
    setInterview(false);
    setTurnBefore(undefined);
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
      setSelected(receipt.threadId);
      setListBefore(undefined);
      setTurnBefore(undefined);
      setPrompt('');
      await workspace.refresh();
      if (selected === receipt.threadId) await history.refresh();
    });
  const attach = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 24 * 1024) throw Error('Choose a UTF-8 text file up to 24 KiB.');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      if (text.includes('\0')) throw Error('Choose a text file.');
      const next = prompt + (prompt ? '\n\n' : '') + text;
      if (new TextEncoder().encode(next).length > 32 * 1024) throw Error('The message exceeds 32 KiB.');
      setPrompt(next);
      setError('');
    } catch (e) {
      setError(describe(e));
    }
  };
  const command =
    'omnitron studio connect ' +
    (project ? quote(project) : '--planning') +
    ' --account ' +
    quote(workspace.data?.account ?? '') +
    ' --provider ' +
    currentProvider;
  return (
    <Stack spacing={2.5} sx={{ minWidth: 0 }}>
      <Breadcrumbs
        links={[{ name: 'Agent Studio' }]}
        action={
          <Button
            size="small"
            variant="outlined"
            startIcon={<PlusIcon />}
            onClick={() => reset(null)}
            disabled={busy || !!uncertain.current}
          >
            New conversation
          </Button>
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
          <List dense aria-label="Conversations" disablePadding>
            {threads.map((t) => (
              <ListItemButton
                key={t.id}
                selected={selected === t.id}
                onClick={() => reset(t.id)}
                disabled={busy || !!uncertain.current}
              >
                <ListItemText
                  primary={t.title}
                  secondary={labels[t.provider] + ' · ' + t.assignment.preferences.role}
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
            <Typography variant="h6" sx={plain}>
              {thread?.title ?? (interview ? 'Project interview' : 'New conversation')}
            </Typography>
            {!frozen && (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ '& > *': { minWidth: 0, flex: 1 } }}>
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
                  {STUDIO_PROVIDERS.map((v) => (
                    <MenuItem key={v} value={v}>
                      {labels[v]}
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
                  <TextField label="Model" size="small" select value={model} onChange={(e) => setModel(e.target.value)}>
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
              <Alert severity="info">
                <Stack spacing={1} sx={{ minWidth: 0 }}>
                  <Typography variant="body2">
                    Connect your subscription {project ? 'from the project directory' : 'from a local terminal'}.
                  </Typography>
                  <Box component="code" sx={{ ...plain, fontSize: '0.8125rem' }}>
                    {command}
                  </Box>
                  <Button
                    size="small"
                    sx={{ alignSelf: 'start' }}
                    onClick={() =>
                      navigator.clipboard
                        .writeText(command)
                        .then(() => notify.success('Command copied'))
                        .catch((e) => setError(describe(e)))
                    }
                  >
                    Copy command
                  </Button>
                </Stack>
              </Alert>
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
              <Turn
                key={t.id}
                turn={t}
                onStarter={
                  preferences.purpose === 'project-interview' &&
                  can('OmnitronProject.reviewProjectCreation') &&
                  can('OmnitronProject.createProject')
                    ? (href) => navigate(href)
                    : undefined
                }
                onReview={(outcome, note) =>
                  action(async () => {
                    await studio.review({
                      project,
                      threadId: selected!,
                      turnId: t.id,
                      outcome,
                      note,
                      previous: t.review?.at ?? null,
                    });
                    await history.refresh();
                  })
                }
              />
            ))}
            {active ? (
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="body2" role="status">
                  {last.status === 'queued' ? 'Waiting for the connector' : 'Agent is responding…'}
                </Typography>
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
              </Stack>
            ) : !turnBefore && last && last.status !== 'completed' ? (
              <Alert severity="info">Start a new conversation to continue after this turn.</Alert>
            ) : null}
            {!turnBefore && (!selected || (thread && last?.status === 'completed')) && (
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
                            setSelected(pending.threadId);
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
          </Stack>
        </Paper>
      </Box>
    </Stack>
  );
}

function Turn({
  turn,
  onReview,
  onStarter,
}: {
  turn: StudioTurn;
  onReview: (outcome: 'accepted' | 'needs-work', note: string) => Promise<void>;
  onStarter?: ((href: string) => void) | undefined;
}) {
  const [reviewing, setReviewing] = useState(false);
  const [note, setNote] = useState('');
  const proposal = turn.status === 'completed' ? starterLink(turn.answer) : null;
  return (
    <Stack spacing={1.25} sx={{ minWidth: 0 }}>
      <Divider />
      <Typography variant="caption" color="text.secondary">
        You
      </Typography>
      <Typography variant="body2" sx={plain}>
        {turn.prompt}
      </Typography>
      {(turn.answer || turn.failure) && (
        <Typography variant="caption" color="text.secondary">
          Agent
        </Typography>
      )}
      {turn.answer &&
        (turn.status === 'running' ? (
          <Typography variant="body2" sx={plain}>
            {turn.answer}
          </Typography>
        ) : (
          <ResponseMarkdown compact embeddedMedia="text">
            {turn.answer}
          </ResponseMarkdown>
        ))}
      {turn.failure && <Alert severity="warning">{blocked[turn.failure]}</Alert>}
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Chip size="small" label={turn.status} variant="outlined" />
        {turn.usage && (
          <Typography variant="caption" color="text.secondary">
            Input {turn.usage.inputTokens ?? '—'} · output {turn.usage.outputTokens ?? '—'} tokens
          </Typography>
        )}
        {turn.review && (
          <Chip size="small" label={turn.review.outcome === 'accepted' ? 'Accepted' : 'Changes requested'} />
        )}
        {turn.status === 'completed' && (
          <Button
            size="small"
            onClick={() => {
              setNote(turn.review?.note ?? '');
              setReviewing(!reviewing);
            }}
          >
            Review result
          </Button>
        )}
        {proposal && onStarter && (
          <Button size="small" variant="outlined" onClick={() => onStarter(proposal)}>
            Review project starter
          </Button>
        )}
      </Stack>
      {turn.review?.note && (
        <Typography variant="body2" sx={plain}>
          {turn.review.note}
        </Typography>
      )}
      {reviewing && (
        <Stack spacing={1}>
          <TextField
            label="Review note"
            size="small"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            multiline
          />
          <Stack direction="row" spacing={1}>
            {(['accepted', 'needs-work'] as const).map((value) => (
              <Button
                size="small"
                key={value}
                onClick={async () => {
                  await onReview(value, note);
                  setReviewing(false);
                }}
              >
                {value === 'accepted' ? 'Accept result' : 'Request changes'}
              </Button>
            ))}
          </Stack>
        </Stack>
      )}
    </Stack>
  );
}
