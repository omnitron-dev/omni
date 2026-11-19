import { Link as RouterLink } from 'react-router-dom';
import { flowHref } from 'src/routes/workspace';
import { useLayoutEffect, useId, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  isPortableFlow,
  isFlowReviewOffer,
  isFlowReviewInvitation,
  type FlowReviewInvitation,
  type FlowReviewOffer,
  type FlowWorkspace,
  type FlowSubmissionReceipt,
  type SavedFlow,
} from '@omnitron-dev/omnitron/dto/services';
import { useCopyToClipboard } from '@omnitron-dev/prism/core';
import { useAccess } from 'src/auth/access';
import { flowReviews, nodes } from 'src/netron/client';
import { usePolledResource } from 'src/hooks/use-polled-resource';

function PublicDocument({ label, value }: { label: string; value: unknown }) {
  const copy = useCopyToClipboard();
  const text = JSON.stringify(value);
  return (
    <Stack spacing={0.5} sx={{ alignItems: 'start' }}>
      <TextField
        fullWidth
        size="small"
        multiline
        maxRows={3}
        label={label}
        value={text}
        slotProps={{ input: { readOnly: true } }}
        onFocus={(e) => e.target.select()}
      />
      <Button size="small" onClick={() => void copy.copy(text)}>
        {copy.state === 'success' ? 'Copied' : 'Copy ' + label.toLowerCase()}
      </Button>
    </Stack>
  );
}
function documentValue<T>(text: string, validate: (value: unknown) => value is T): T | null {
  if (!text || text.length > 8192) return null;
  try {
    const value: unknown = JSON.parse(text);
    return validate(value) ? value : null;
  } catch {
    return null;
  }
}
function ReviewDialog({
  workspace,
  saved,
  ready,
  onClose,
}: {
  workspace: FlowWorkspace;
  saved?: SavedFlow;
  ready: boolean;
  onClose(): void;
}) {
  const { can } = useAccess();
  const titleId = useId();
  const [transferId, setTransferId] = useState(() => crypto.randomUUID());
  const [nodeId, setNode] = useState('');
  const [input, setInput] = useState('');
  const [offer, setOffer] = useState<FlowReviewOffer | null>(null);
  const [invitation, setInvitation] = useState<FlowReviewInvitation | null>(null);
  const [result, setResult] = useState('');
  const [received, setReceived] = useState<FlowSubmissionReceipt | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const initiatingControl = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!busy && initiatingControl.current) {
      initiatingControl.current.focus();
      initiatingControl.current = null;
    }
  }, [busy]);
  const listNodes = !!saved && can('OmnitronNodes.listNodes');
  const inventory = usePolledResource(() => nodes.listNodes(), { enabled: listNodes, intervalMs: 0, paused: true });
  const candidate = documentValue(input, isFlowReviewOffer);
  const ticket = documentValue(input, isFlowReviewInvitation);
  const selected = saved ? ticket?.offer : candidate;
  const matching =
    selected?.workspace?.project === workspace.project &&
    (selected?.workspace?.stack ?? null) === (workspace.stack ?? null);
  const changeNode = (id: string) => {
    setNode(id);
    setTransferId(crypto.randomUUID());
    setOffer(null);
    setInput('');
    setError('');
    setResult('');
  };
  const work = async (fn: () => Promise<void>) => {
    if (busy) return;
    initiatingControl.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setBusy(true);
    setReceived(null);
    setError('');
    setResult('');
    try {
      await fn();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  const send = (mode: 'send' | 'receipt') =>
    work(async () => {
      if (!saved || !ticket || !selected || (mode === 'send' && (!ready || selected.sourceRevision !== saved.revision)))
        return;
      const response = await flowReviews.deliver({
        workspace,
        id: saved.id,
        revision: selected.sourceRevision,
        nodeId,
        mode,
        invitation: ticket,
      });
      setResult(
        response
          ? 'Received on the other controller · draft ' + response.id + ' · revision ' + response.revision
          : 'The receiving controller has not recorded this transfer.'
      );
    });
  return (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      aria-labelledby={titleId}
      aria-busy={busy}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <DialogTitle id={titleId}>{saved ? 'Share a flow with a controller' : 'Receive a flow for review'}</DialogTitle>
      {busy && <LinearProgress aria-label="Waiting for controller" />}
      <DialogContent>
        <Stack spacing={2} sx={{ overflowWrap: 'anywhere' }}>
          <Typography variant="subtitle2">
            {[workspace.project, workspace.stack].filter(Boolean).join(' / ')}
          </Typography>
          {saved ? (
            <>
              <Typography variant="body2">
                {saved.definition.name} · revision {saved.revision}
              </Typography>
              {saved.definition.nodes.map((n) => (
                <Typography variant="body2" key={n.id}>
                  {n.id} ·{' '}
                  {n.type === 'input.manual@1'
                    ? 'Manual input'
                    : n.type === 'output.notify@1'
                      ? 'Local notification · ' + String(n.config['title'])
                      : n.type}
                </Typography>
              ))}
              {saved.definition.edges.map((edge) => (
                <Typography variant="caption" key={edge.to}>
                  {edge.from} · {edge.port} → {edge.to}
                </Typography>
              ))}
              {listNodes ? (
                <TextField
                  select
                  size="small"
                  label="Receiving controller"
                  value={nodeId}
                  disabled={busy}
                  onChange={(event) => changeNode(event.target.value)}
                >
                  <MenuItem value="">Select an enrolled node</MenuItem>
                  {inventory.data
                    ?.filter((n) => !n.isLocal)
                    .map((n) => (
                      <MenuItem key={n.id} value={n.id}>
                        {n.name} · {n.host} · {n.id}
                      </MenuItem>
                    ))}
                </TextField>
              ) : (
                <TextField
                  label="Receiving node UUID"
                  value={nodeId}
                  disabled={busy}
                  onChange={(event) => changeNode(event.target.value)}
                />
              )}
              {inventory.error && (
                <Alert severity="error" action={<Button onClick={() => void inventory.refresh()}>Retry</Button>}>
                  {inventory.error}
                </Alert>
              )}
              <Typography variant="body2">
                {ready
                  ? 'Give the public offer to the administrator of the receiving project. Its digest identifies this graph.'
                  : 'Paste the original invitation and select the original controller to check the receipt.'}
              </Typography>
              {ready && can('OmnitronFlowReviews.prepare') && (
                <Button
                  sx={{ alignSelf: 'start' }}
                  size="small"
                  variant="outlined"
                  disabled={!nodeId || busy}
                  onClick={() =>
                    void work(async () => {
                      setOffer(
                        await flowReviews.prepare({
                          workspace,
                          id: saved.id,
                          revision: saved.revision,
                          nodeId,
                          transferId,
                        })
                      );
                    })
                  }
                >
                  Prepare public offer
                </Button>
              )}
              {offer && !matching && <PublicDocument label="Public offer" value={offer} />}
            </>
          ) : (
            <Typography variant="body2">
              Paste the offer from the sending administrator and verify the source registration and digest. A ten-minute
              invitation admits one paused draft into this project.
            </Typography>
          )}
          <TextField
            fullWidth
            multiline
            maxRows={4}
            size="small"
            label={saved ? 'Invitation from receiving controller' : 'Public offer from sender'}
            value={input}
            disabled={busy}
            onChange={(e) => {
              setInput(e.target.value);
              setReceived(null);
              setInvitation(null);
              setError('');
              setResult('');
            }}
            slotProps={{ htmlInput: { maxLength: 8192 } }}
          />
          {input && !matching && <Alert severity="warning">Use the public document for this project and stack.</Alert>}
          {matching && selected && (
            <Stack spacing={0.5}>
              <Typography variant="caption">Transfer {String(selected.transferId)}</Typography>
              <Typography variant="caption">Source registration {String(selected.sourceRegistration)}</Typography>
              <Typography variant="caption">Graph digest {String(selected.digest)}</Typography>
              {saved && ticket && (
                <Typography variant="caption">
                  Receiving registration {String(ticket.destinationRegistration)} · expires{' '}
                  {new Date(ticket.expiresAt).toLocaleString()}
                </Typography>
              )}
            </Stack>
          )}
          {saved && matching && selected?.sourceRevision !== saved.revision && (
            <Alert severity="info">
              This invitation describes an earlier revision. Its original receipt can be checked.
            </Alert>
          )}
          {invitation && <PublicDocument label="Public invitation" value={invitation} />}
        </Stack>
      </DialogContent>
      {(result || error || received) && (
        <Stack
          spacing={0.5}
          sx={{ px: 3, py: 0.5, overflowWrap: 'anywhere', maxHeight: '25dvh', overflowY: 'auto', flexShrink: 0 }}
        >
          {result && (
            <Alert severity="info" role="status">
              {result}
            </Alert>
          )}
          {received && (
            <Button component={RouterLink} to={flowHref(received.workspace, { flow: received.id })} onClick={onClose}>
              Open received draft
            </Button>
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      )}
      <DialogActions sx={{ flexWrap: 'wrap', gap: 0.5 }}>
        <Button autoFocus disabled={busy} onClick={onClose}>
          Close
        </Button>
        {saved && can('OmnitronFlowReviews.deliver') && (
          <>
            <Button disabled={busy || !matching || !nodeId} onClick={() => void send('receipt')}>
              Check receipt
            </Button>
            <Button
              variant="contained"
              disabled={busy || !ready || !matching || !nodeId || selected?.sourceRevision !== saved.revision}
              onClick={() => void send('send')}
            >
              Send reviewed graph
            </Button>
          </>
        )}
        {!saved && can('OmnitronFlowReviews.incomingReceipt') && (
          <Button
            disabled={busy || !matching}
            onClick={() =>
              void work(async () => {
                const receipt = await flowReviews.incomingReceipt({ workspace, offer: candidate! });
                setReceived(receipt);
                setResult(
                  receipt ? 'Received · original revision ' + receipt.revision : 'Waiting for the sending controller.'
                );
              })
            }
          >
            Check incoming transfer
          </Button>
        )}
        {!saved && can('OmnitronFlowReviews.revoke') && (
          <Button
            disabled={busy || !matching}
            onClick={() =>
              void work(async () => {
                await flowReviews.revoke({ workspace, offer: candidate! });
                setInvitation(null);
                setResult('Invitation revoked.');
              })
            }
          >
            Revoke invitation
          </Button>
        )}
        {!saved && can('OmnitronFlowReviews.invite') && (
          <Button
            variant="contained"
            disabled={busy || !matching}
            onClick={() =>
              void work(async () => {
                setInvitation(await flowReviews.invite({ workspace, offer: candidate! }));
              })
            }
          >
            Issue invitation
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export function FlowPeerReview({
  workspace,
  saved,
  current = true,
}: {
  workspace: FlowWorkspace;
  saved?: SavedFlow;
  current?: boolean;
}) {
  const { can } = useAccess();
  const [open, setOpen] = useState(false);
  if (
    !workspace.project ||
    (saved
      ? !can('OmnitronFlowReviews.prepare') && !can('OmnitronFlowReviews.deliver')
      : !can('OmnitronFlowReviews.invite') &&
        !can('OmnitronFlowReviews.revoke') &&
        !can('OmnitronFlowReviews.incomingReceipt'))
  )
    return null;
  const eligible = !saved || isPortableFlow(saved.definition);
  const ready = current && eligible;
  const receiptOnly = !!saved && !ready;
  return (
    <Stack sx={{ alignItems: 'start' }} spacing={0.5}>
      <Button
        variant="outlined"
        size="small"
        disabled={receiptOnly && !can('OmnitronFlowReviews.deliver')}
        onClick={() => setOpen(true)}
      >
        {saved ? (receiptOnly ? 'Check transfer receipt' : 'Share with a controller') : 'Receive a flow'}
      </Button>
      {!eligible && (
        <Typography variant="caption">Peer review accepts manual inputs and local notifications.</Typography>
      )}
      {open && (
        <ReviewDialog workspace={workspace} ready={ready} {...(saved && { saved })} onClose={() => setOpen(false)} />
      )}
    </Stack>
  );
}
