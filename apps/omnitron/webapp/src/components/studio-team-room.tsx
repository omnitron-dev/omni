import { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { Alert } from '@omnitron-dev/prism/components/alert';
import type {
  StudioHistory,
  StudioMember,
  StudioModelCatalog,
  StudioNote,
  StudioNoteInput,
  StudioPost,
  StudioRoomRef,
  StudioTurn,
} from '@omnitron-dev/omnitron/dto/services';
import { useAccess } from 'src/auth/access';
import { studio } from 'src/netron/client';
import { attachStudioText } from 'src/utils/studio-message';
import { StudioFlowProposalRow } from './studio-flow-proposal';
import { StudioTeamEditor, studioProviderNames } from './studio-team-editor';
import { StudioTurnCard } from './studio-turn';

export const studioSections = ['chat', 'tasks', 'memory', 'members', 'flows'] as const;
export type StudioSection = (typeof studioSections)[number];
interface Props {
  room: StudioRoomRef;
  history: StudioHistory;
  account: string;
  catalogs: StudioModelCatalog[];
  latest: boolean;
  section: StudioSection;
  setSection(section: StudioSection): void;
  tasksState: 'loading' | 'unavailable' | 'ready';
  refresh: () => Promise<void>;
}

export function StudioTeamRoom({
  room,
  history,
  account,
  catalogs,
  latest,
  section,
  setSection,
  tasksState,
  refresh,
}: Props) {
  const { team, thread } = history;
  const { can } = useAccess();
  const [editor, setEditor] = useState<'member' | 'policy' | null>(null);
  const [retiring, setRetiring] = useState<StudioMember | null>(null);
  const [draft, setDraft] = useState('');
  const [memberId, setMemberId] = useState(thread.leadMemberId);
  const [pending, setPending] = useState<StudioPost | null>(null);
  const [composerKind, setComposerKind] = useState<{ section: StudioSection; value: StudioPost['kind'] }>();
  const kind =
    pending?.kind ??
    (composerKind?.section === section ? composerKind.value : section === 'tasks' ? 'task' : 'message');
  const setKind = (value: StudioPost['kind']) => setComposerKind({ section, value });
  const [note, setNote] = useState<StudioNoteInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = team.members.filter((member) => member.active);
  const memberName = (id: string | null) =>
    id ? (team.members.find((member) => member.id === id)?.name ?? 'Former member') : 'Operator';
  const recipient = active.some((member) => member.id === memberId) ? memberId : thread.leadMemberId;
  const addressed = pending?.memberId ?? recipient;
  const recipientChoices = team.members.filter((member) => member.active || member.id === addressed);
  const run = async (change: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await change();
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  const post = () =>
    run(async () => {
      const request = pending ?? { ...room, turnId: crypto.randomUUID(), memberId: recipient, kind, text: draft };
      setPending(request);
      await studio.post(request);
      setPending(null);
      setDraft('');
    });
  const editNote = (value?: StudioNote) =>
    setNote(
      value ? { key: value.key, text: value.text, revision: value.revision } : { key: '', text: '', revision: 0 }
    );
  const visibleTurns = section === 'tasks' ? team.tasks : history.turns;
  const canPost = can('OmnitronStudio.post');
  const reviewedTurn = (turn: StudioTurn) => (
    <StudioTurnCard
      key={turn.id}
      turn={turn}
      author={memberName(turn.authorId)}
      recipient={memberName(turn.memberId)}
      related={visibleTurns.some((item) => item.id === turn.originId) ? (turn.originId ?? undefined) : undefined}
      onCancel={
        can('OmnitronStudio.cancel') && (turn.status === 'queued' || turn.status === 'running')
          ? () =>
              run(async () => {
                await studio.cancel({ ...room, turnId: turn.id });
              })
          : undefined
      }
      onReview={
        can('OmnitronStudio.review')
          ? (outcome, text, previous) =>
              run(async () => {
                await studio.review({ ...room, turnId: turn.id, outcome, note: text, previous });
              })
          : undefined
      }
    />
  );
  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <Stack
        direction="row"
        useFlexGap
        spacing={0.75}
        sx={{ flexWrap: 'wrap', alignItems: 'center' }}
        aria-label="Team roster"
      >
        {active.map((member) => (
          <Chip
            size="small"
            key={member.id}
            label={member.name + (member.lead ? ' · Lead' : '')}
            onClick={() => setSection('members')}
          />
        ))}
      </Stack>
      <Tabs
        value={section}
        onChange={(_, value: StudioSection) => {
          setSection(value);
          setComposerKind(undefined);
        }}
        variant="scrollable"
        scrollButtons="auto"
        aria-label="Team workspace"
      >
        {studioSections.map((key) => (
          <Tab
            key={key}
            id={'studio-tab-' + key}
            aria-controls="studio-team-panel"
            label={key[0]!.toUpperCase() + key.slice(1)}
            value={key}
          />
        ))}
      </Tabs>
      <Stack role="tabpanel" id="studio-team-panel" aria-labelledby={'studio-tab-' + section} spacing={1.5}>
        {error && <Alert severity="error">{error}</Alert>}
        {(section === 'chat' || section === 'tasks') && (
          <>
            {visibleTurns.map(reviewedTurn)}
            {section === 'tasks' && tasksState !== 'ready' && (
              <Typography role="status" variant="body2">
                {tasksState === 'loading' ? 'Loading team tasks…' : 'Team tasks unavailable.'}
              </Typography>
            )}
            {!visibleTurns.length && !(section === 'tasks' && tasksState !== 'ready') && (
              <Typography variant="body2" color="text.secondary">
                {section === 'tasks' ? 'No tasks assigned.' : 'No messages yet.'}
              </Typography>
            )}
            {latest && canPost && (
              <Box
                component="form"
                aria-busy={busy}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!busy && (pending || draft.trim())) void post();
                }}
              >
                <Stack spacing={1.5}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                    <TextField
                      select
                      fullWidth
                      size="small"
                      label="Recipient"
                      value={addressed}
                      disabled={!!pending || busy}
                      onChange={(event) => setMemberId(event.target.value)}
                    >
                      {recipientChoices.map((member) => (
                        <MenuItem key={member.id} value={member.id}>
                          {member.name}
                          {member.lead ? ' · Lead' : ''}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      select
                      fullWidth
                      size="small"
                      label="Send as"
                      value={kind}
                      disabled={!!pending || busy}
                      onChange={(event) => setKind(event.target.value as StudioPost['kind'])}
                    >
                      <MenuItem value="message">Message</MenuItem>
                      <MenuItem value="task">Task</MenuItem>
                    </TextField>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    The team journal and memory are available to all assigned adapters. {memberName(addressed)} receives
                    this message and attached text through{' '}
                    {
                      studioProviderNames[
                        recipientChoices.find((member) => member.id === addressed)?.provider ?? thread.provider
                      ]
                    }
                    .
                  </Typography>
                  <TextField
                    label={kind === 'task' ? 'Task' : 'Message'}
                    multiline
                    minRows={3}
                    maxRows={10}
                    value={draft}
                    disabled={!!pending || busy}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === 'Enter' &&
                        (event.ctrlKey || event.metaKey) &&
                        draft.trim() &&
                        !busy &&
                        !pending
                      ) {
                        event.preventDefault();
                        void post();
                      }
                    }}
                  />
                  <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
                    <Button size="small" component="label" disabled={!!pending || busy}>
                      Attach text
                      <input
                        type="file"
                        hidden
                        onChange={async (event) => {
                          const file = event.target.files?.[0];
                          event.target.value = '';
                          if (file) {
                            try {
                              setDraft(await attachStudioText(file, draft));
                            } catch (failure) {
                              setError(String(failure));
                            }
                          }
                        }}
                      />
                    </Button>
                    {pending && can('OmnitronStudio.cancel') && (
                      <Button
                        size="small"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const receipt = await studio.cancel({ ...room, turnId: pending.turnId });
                            setPending(null);
                            if (receipt.status !== 'withdrawn') setDraft('');
                          })
                        }
                      >
                        Withdraw request
                      </Button>
                    )}
                    <Button
                      type="submit"
                      size="small"
                      variant="contained"
                      disabled={busy || !active.length || (!draft.trim() && !pending)}
                      sx={{ ml: 'auto' }}
                    >
                      {pending && !busy ? 'Retry same request' : kind === 'task' ? 'Assign task' : 'Send message'}
                    </Button>
                  </Stack>
                </Stack>
              </Box>
            )}
          </>
        )}
        {section === 'members' && (
          <>
            {team.members.map((member) => (
              <Stack key={member.id} direction="row" spacing={1} sx={{ minWidth: 0, alignItems: 'center' }}>
                <Box sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                  <Typography variant="subtitle2">
                    {member.name}
                    {member.lead ? ' · Lead' : ''}
                    {member.active ? '' : ' · Retired'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {member.assignment.preferences.role} · {studioProviderNames[member.provider]} ·{' '}
                    {member.assignment.selection.model}
                  </Typography>
                </Box>
                {member.active && !member.lead && can('OmnitronStudio.retireMember') && (
                  <Button
                    size="small"
                    disabled={busy}
                    aria-label={'Retire ' + member.name}
                    onClick={() => setRetiring(member)}
                  >
                    Retire
                  </Button>
                )}
              </Stack>
            ))}
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {can('OmnitronStudio.addMember') && team.policy && (
                <Button
                  variant="outlined"
                  disabled={busy || active.length >= team.policy.maxMembers}
                  onClick={() => setEditor('member')}
                >
                  Add member
                </Button>
              )}
              {can('OmnitronStudio.configureTeam') && <Button onClick={() => setEditor('policy')}>Team limits</Button>}
            </Stack>
          </>
        )}
        {section === 'flows' && (
          <>
            {team.proposals?.length ? (
              team.proposals.map((proposal) => (
                <StudioFlowProposalRow
                  key={proposal.id}
                  proposal={proposal}
                  room={room}
                  stack={thread.stack ?? null}
                  author={memberName(proposal.authorId)}
                />
              ))
            ) : (
              <Typography variant="body2" color="text.secondary">
                No proposed flows yet.
              </Typography>
            )}
          </>
        )}
        {section === 'memory' && (
          <>
            {team.notes.map((item) => (
              <Stack key={item.key} spacing={0.5}>
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>
                    {item.key}
                  </Typography>
                  {can('OmnitronStudio.writeNote') && (
                    <Button size="small" aria-label={'Edit ' + item.key} onClick={() => editNote(item)}>
                      Edit
                    </Button>
                  )}
                </Stack>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {item.text}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {memberName(item.authorId)} · revision {item.revision}
                </Typography>
              </Stack>
            ))}
            {!team.notes.length && (
              <Typography variant="body2" color="text.secondary">
                No shared notes yet.
              </Typography>
            )}
            {can('OmnitronStudio.writeNote') && !note && (
              <Button sx={{ alignSelf: 'start' }} size="small" variant="outlined" onClick={() => editNote()}>
                Add note
              </Button>
            )}
            {note && can('OmnitronStudio.writeNote') && (
              <Stack spacing={1.25}>
                <TextField
                  label="Note key"
                  size="small"
                  value={note.key}
                  disabled={note.revision > 0 || busy}
                  onChange={(event) => setNote({ ...note, key: event.target.value })}
                />
                <TextField
                  label="Shared note"
                  helperText="Members can send this note to their assigned adapters."
                  value={note.text}
                  disabled={busy}
                  multiline
                  minRows={3}
                  onChange={(event) => setNote({ ...note, text: event.target.value })}
                />
                <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                  <Button onClick={() => setNote(null)} disabled={busy}>
                    Cancel
                  </Button>
                  <Button
                    variant="contained"
                    disabled={busy || !note.key.trim() || !note.text.trim()}
                    onClick={() =>
                      void run(async () => {
                        await studio.writeNote({ ...room, ...note });
                        setNote(null);
                      })
                    }
                  >
                    Save note
                  </Button>
                </Stack>
              </Stack>
            )}
          </>
        )}
      </Stack>
      <Dialog
        aria-labelledby="studio-team-editor-title"
        open={!!editor}
        onClose={() => setEditor(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle id="studio-team-editor-title">
          {editor === 'member' ? 'Add team member' : 'Team limits'}
        </DialogTitle>
        <DialogContent>
          {editor && (
            <StudioTeamEditor
              key={editor}
              mode={editor}
              room={room}
              stack={thread.stack}
              leadProvider={thread.provider}
              catalogs={catalogs}
              account={account}
              policy={team.policy}
              onClose={() => setEditor(null)}
              onSaved={async () => {
                setEditor(null);
                await refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog aria-labelledby="studio-retire-title" open={!!retiring} onClose={() => setRetiring(null)}>
        <DialogTitle id="studio-retire-title">Retire {retiring?.name}?</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Typography variant="body2">
              This member will leave the active team. Their messages and tasks stay in the journal.
            </Typography>
            <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
              <Button onClick={() => setRetiring(null)}>Cancel</Button>
              <Button
                color="warning"
                disabled={busy}
                onClick={() => {
                  if (retiring)
                    void run(async () => {
                      await studio.retireMember({ ...room, memberId: retiring.id });
                      setRetiring(null);
                    });
                }}
              >
                Retire member
              </Button>
            </Stack>
          </Stack>
        </DialogContent>
      </Dialog>
    </Stack>
  );
}
