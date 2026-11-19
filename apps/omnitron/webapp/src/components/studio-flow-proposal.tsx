import { useEffect, useId, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { useCopyToClipboard } from '@omnitron-dev/prism/core';
import type { FlowSubmissionReceipt, StudioFlowProposal, StudioRoomRef } from '@omnitron-dev/omnitron/dto/services';
import { useAccess } from 'src/auth/access';
import { flows } from 'src/netron/client';
import { flowHref } from 'src/routes/workspace';

export function StudioFlowProposalRow({
  proposal,
  room,
  stack,
  author,
}: {
  proposal: StudioFlowProposal;
  room: StudioRoomRef;
  stack: string | null;
  author: string;
}) {
  const { can } = useAccess();
  const maySubmit = can('OmnitronFlows.submitProposal');
  const titleId = useId();
  const receiptStatus = useRef<HTMLParagraphElement>(null);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<FlowSubmissionReceipt | null>(null);
  const clipboard = useCopyToClipboard({ resetTimeout: 0 });
  useEffect(() => {
    if (receipt) receiptStatus.current?.focus();
  }, [receipt]);
  const workspace = { project: room.project, stack };
  const scope = [room.project ?? 'Controller', stack].filter(Boolean).join(' / ');
  const href = receipt ? flowHref(receipt.workspace, { flow: receipt.id }) : null;
  const submit = async () => {
    if (busy || !maySubmit) return;
    setBusy(true);
    setError('');
    try {
      setReceipt(await flows.submitProposal({ ...room, proposalId: proposal.id }));
      setReview(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack spacing={0.75} sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
      <Typography variant="subtitle2">{proposal.name}</Typography>
      <Typography variant="caption" color="text.secondary">
        {author} · {new Date(proposal.createdAt).toLocaleString()}
      </Typography>
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
        {can('OmnitronStudio.flowProposal') && (
          <Button
            component={RouterLink}
            size="small"
            to={flowHref(workspace, { team: room.threadId, proposal: proposal.id })}
          >
            Open in flow editor
          </Button>
        )}
        {!receipt && maySubmit && (
          <Button
            size="small"
            variant="outlined"
            onClick={() => {
              setError('');
              setReview(true);
            }}
          >
            Submit for administrator review
          </Button>
        )}
      </Stack>
      {receipt && href && (
        <Stack spacing={0.75} sx={{ alignItems: 'start' }}>
          <Typography role="status" variant="body2" tabIndex={-1} ref={receiptStatus}>
            Submitted for review in{' '}
            {[receipt.workspace.project ?? 'Controller', receipt.workspace.stack].filter(Boolean).join(' / ')}.
          </Typography>
          <Typography variant="caption">
            Draft {receipt.id} · submitted revision {receipt.revision}
          </Typography>
          <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
            <Button size="small" onClick={() => void clipboard.copy(new URL(href, window.location.href).href)}>
              {clipboard.state === 'success' ? 'Review link copied' : 'Copy review link'}
            </Button>
            {can('OmnitronFlows.get') && (
              <Button component={RouterLink} to={href} size="small">
                Open shared draft
              </Button>
            )}
          </Stack>
          {clipboard.state === 'error' && (
            <TextField
              fullWidth
              size="small"
              label="Review link for an administrator"
              value={new URL(href, window.location.href).href}
              slotProps={{ input: { readOnly: true } }}
              onFocus={(event) => event.target.select()}
            />
          )}
        </Stack>
      )}
      {review && maySubmit && (
        <Dialog
          open
          aria-labelledby={titleId}
          fullWidth
          maxWidth="sm"
          onClose={() => {
            if (!busy) setReview(false);
          }}
        >
          <DialogTitle id={titleId}>Submit for administrator review</DialogTitle>
          <DialogContent>
            <Stack spacing={1.5} sx={{ overflowWrap: 'anywhere' }}>
              <Typography variant="subtitle2">
                {proposal.name} · {scope}
              </Typography>
              <Typography variant="body2">
                Share the original proposal's nodes, connections and configuration values with administrators in this
                workspace. Team messages and notes stay private.
              </Typography>
              <Typography variant="body2">
                The shared draft starts paused. An administrator reviews activation separately. Submitting again returns
                the original receipt.
              </Typography>
              {error && <Alert severity="error">{error}</Alert>}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button autoFocus disabled={busy} onClick={() => setReview(false)}>
              Cancel
            </Button>
            <Button variant="contained" disabled={busy} onClick={() => void submit()}>
              {busy ? 'Submitting…' : 'Submit draft'}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Stack>
  );
}
