import { useState } from 'react';
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import { Alert } from '@omnitron-dev/prism/components/alert';
import type {
  FlowChange,
  FlowDelivery,
  FlowNodeDescriptor,
  FlowReceipt,
  SavedFlow,
} from '@omnitron-dev/omnitron/dto/services';
import { useAccess } from 'src/auth/access';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { flows } from 'src/netron/client';
import { formatDate } from 'src/utils/formatters';
import { meshDisk } from './flow-disk-source';
import { FlowEffects, type ReviewedEvent } from './flow-sample';

export const describeFlowError = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure));
const labels = {
  activate: 'Activate flow',
  deactivate: 'Pause flow',
  submit: 'Send live event',
  retry: 'Retry delivery',
};
type Review = { ref: FlowChange } & (
  | { kind: 'activate' | 'deactivate'; flow: SavedFlow }
  | { kind: 'submit'; sample: ReviewedEvent }
  | { kind: 'retry'; delivery: FlowDelivery }
);

function Receipt({
  receipt,
  allowRetry,
  retry,
}: {
  receipt: FlowReceipt;
  allowRetry: boolean;
  retry(delivery: FlowDelivery): void;
}) {
  const fmt = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));
  return (
    <Box
      component="details"
      sx={{ py: 1, borderTop: 1, borderColor: 'divider', typography: 'body2', overflowWrap: 'anywhere' }}
    >
      <summary>
        {formatDate(new Date(receipt.at))} · {receipt.event.source} · {receipt.event.type} · {receipt.deliveries.length}{' '}
        {receipt.deliveries.length === 1 ? 'effect' : 'effects'}
      </summary>
      <Stack spacing={1} sx={{ pl: 1.25, pt: 1 }}>
        <Typography variant="caption">
          Event {receipt.event.id} · activation {receipt.activation} · revision {receipt.revision}
        </Typography>
        {receipt.event.type === 'mesh.disk.sample' && (
          <Typography variant="body2">
            Disk observation from {String(receipt.event.data['mount'])} on enrolled node{' '}
            {String(receipt.event.data['nodeId'])}. Recorded by this controller.
          </Typography>
        )}
        {Object.entries(receipt.event.data)
          .filter(([key]) => receipt.event.type !== 'mesh.disk.sample' || !['nodeId', 'mount'].includes(key))
          .map(([key, value]) => (
            <Typography key={key} variant="body2">
              {key} · {fmt(value)}
            </Typography>
          ))}
        <Typography variant="body2">Visited · {receipt.visited.join(', ')}</Typography>
        {receipt.traversed.map((edge) => (
          <Typography variant="caption" key={[edge.from, edge.port, edge.to].join(':')}>
            {edge.from} · {edge.port} → {edge.to}
          </Typography>
        ))}
        {Object.entries(receipt.state).map(([key, state]) => (
          <Typography variant="caption" key={key}>
            {key} · {String(state)}
          </Typography>
        ))}
        {receipt.deliveries.map((delivery) => (
          <Stack key={delivery.id} spacing={0.5}>
            <Typography variant="subtitle2">
              {delivery.title} · {delivery.status}
            </Typography>
            <Typography variant="caption">
              {delivery.nodeId} · {delivery.kind} · {delivery.id}
            </Typography>
            {delivery.result && <Typography variant="body2">Result · {delivery.result}</Typography>}
            {delivery.error && <Alert severity="warning">{delivery.error}</Alert>}
            {delivery.status === 'needs-review' && allowRetry && (
              <Button size="small" sx={{ alignSelf: 'start' }} onClick={() => retry(delivery)}>
                Review delivery retry
              </Button>
            )}
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

export function FlowOperations({
  saved,
  catalog,
  current,
  sample,
  setSaved,
}: {
  saved: SavedFlow;
  catalog: FlowNodeDescriptor[];
  current: boolean;
  sample: ReviewedEvent | null;
  setSaved(flow: SavedFlow): void;
}) {
  const { can, snapshot } = useAccess();
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const ref = {
    workspace: saved.workspace,
    id: saved.id,
    revision: saved.revision,
    activation: saved.active?.id ?? null,
  };
  const mayRead = can('OmnitronFlows.history');
  const history = usePolledResource(() => flows.history({ workspace: saved.workspace, id: saved.id, limit: 30 }), {
    resourceKey: saved.id,
    intervalMs: 10000,
    enabled: mayRead,
  });
  const eligible = sample && saved.definition.nodes.find((node) => node.id === sample.event.source);
  const liveEvent =
    eligible?.type === 'input.manual@1' ||
    (eligible?.type === 'input.event@1' &&
      !['host.disk.sample', 'mesh.disk.sample', 'stack.started', 'stack.stopped'].includes(sample!.event.type));
  const open = (command: Review) => {
    setReview(command);
    setError('');
    setNotice('');
  };
  const confirm = async () => {
    if (!review || busy) return;
    setBusy(true);
    setError('');
    try {
      if (review.kind === 'activate' || review.kind === 'deactivate') setSaved(await flows[review.kind](review.ref));
      if (review.kind === 'submit') {
        const receipt = await flows.submit({
          id: review.ref.id,
          workspace: review.ref.workspace,
          activation: review.ref.activation!,
          event: review.sample.event,
        });
        setNotice('Event recorded · ' + receipt.event.id);
      }
      if (review.kind === 'retry') {
        const delivery = await flows.retryDelivery({
          id: review.ref.id,
          workspace: review.ref.workspace,
          activation: review.ref.activation!,
          delivery: review.delivery.id,
        });
        setNotice('Delivery ' + delivery.id + ' · ' + delivery.status);
      }
      setReview(null);
      if (mayRead) void history.refresh();
    } catch (failure) {
      setError(describeFlowError(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack spacing={1.25} aria-label="Flow runtime" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
      <Stack direction="row" useFlexGap spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="subtitle2">Runtime</Typography>
        <Chip size="small" color={saved.active ? 'success' : 'default'} label={saved.active ? 'Active' : 'Paused'} />
        {current && saved.active?.revision !== saved.revision && can('OmnitronFlows.activate') && (
          <Button size="small" variant="outlined" onClick={() => open({ kind: 'activate', ref, flow: saved })}>
            Review activation
          </Button>
        )}
        {saved.active && can('OmnitronFlows.deactivate') && (
          <Button size="small" onClick={() => open({ kind: 'deactivate', ref, flow: saved })}>
            Review pause
          </Button>
        )}
        {saved.active &&
          saved.active.revision === saved.revision &&
          current &&
          sample &&
          liveEvent &&
          can('OmnitronFlows.submit') && (
            <Button size="small" variant="outlined" onClick={() => open({ kind: 'submit', ref, sample })}>
              Review live event
            </Button>
          )}
      </Stack>
      <Typography variant="caption">Draft revision {saved.revision}</Typography>
      {saved.active && (
        <Typography variant="caption">
          Active revision {saved.active.revision} · activated by {saved.active.actor} ·{' '}
          {formatDate(new Date(saved.active.startedAt))}
        </Typography>
      )}
      {saved.sources.map((source) => {
        const input = saved.active?.definition.nodes.find((n) => n.id === source.nodeId);
        const location =
          input?.type === meshDisk
            ? String(input.config['mount']) + ' on enrolled node ' + String(input.config['nodeId'])
            : null;
        return (
          <Typography key={source.nodeId} variant="body2" color={source.error ? 'warning.main' : 'text.secondary'}>
            {source.nodeId}
            {location && ' · ' + location} · {source.error ?? 'Next sample ' + formatDate(new Date(source.dueAt))}
          </Typography>
        );
      })}
      {notice && <Alert severity="success">{notice}</Alert>}
      {mayRead && (
        <>
          <Typography variant="subtitle2">Recent events</Typography>
          {history.error && (
            <Alert severity="error" action={<Button onClick={() => void history.refresh()}>Retry</Button>}>
              {history.error}
            </Alert>
          )}
          {history.data?.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              No recorded events.
            </Typography>
          )}
          {history.data?.map((receipt) => (
            <Receipt
              key={receipt.activation + ':' + receipt.event.id}
              receipt={receipt}
              allowRetry={
                can('OmnitronFlows.retryDelivery') &&
                saved.active?.id === receipt.activation &&
                saved.active.actor === snapshot?.userId
              }
              retry={(delivery) => open({ kind: 'retry', ref, delivery })}
            />
          ))}
        </>
      )}
      {review && (
        <Dialog
          open
          fullWidth
          maxWidth="sm"
          aria-labelledby="flow-review-title"
          onClose={() => {
            if (!busy) setReview(null);
          }}
        >
          <DialogTitle id="flow-review-title">{labels[review.kind]}</DialogTitle>
          <DialogContent>
            <Stack spacing={1.25} sx={{ overflowWrap: 'anywhere' }}>
              <Typography variant="body2">
                {review.ref.workspace.project ?? 'Controller'}
                {review.ref.workspace.stack && ' / ' + review.ref.workspace.stack} · {saved.definition.name}
              </Typography>
              <Typography variant="caption">
                Reviewed revision {review.ref.revision}
                {review.ref.activation && ' · activation ' + review.ref.activation}
              </Typography>
              {review.kind === 'activate' && (
                <>
                  <Typography variant="body2">
                    Activation starts the configured sources and permits their connected outputs.
                  </Typography>
                  {review.flow.definition.nodes
                    .filter((n) =>
                      ['output', 'source'].includes(catalog.find((item) => item.type === n.type)?.group ?? '')
                    )
                    .map((n) => (
                      <Box key={n.id}>
                        <Typography variant="subtitle2">
                          {catalog.find((item) => item.type === n.type)?.label ?? n.type} · {n.id}
                        </Typography>
                        {n.type === meshDisk && (
                          <Typography variant="caption" component="div">
                            This node supplies disk readings. This controller records events and dispatches the reviewed
                            outputs.
                          </Typography>
                        )}
                        {Object.entries(n.config).map(([key, value]) => (
                          <Typography key={key} component="div" variant="caption">
                            {key} · {String(value)}
                          </Typography>
                        ))}
                      </Box>
                    ))}
                </>
              )}
              {review.kind === 'deactivate' && (
                <Typography variant="body2">
                  Pause event intake and delivery for this activation. Its history stays in this workspace.
                </Typography>
              )}
              {review.kind === 'submit' && (
                <>
                  <Typography variant="body2">
                    Send {review.sample.event.type} to {review.sample.event.source}. The active flow evaluates the event
                    using its current state.
                  </Typography>
                  <FlowEffects result={review.sample.result} />
                </>
              )}
              {review.kind === 'retry' && (
                <Typography variant="body2">
                  Request another attempt for {review.delivery.title} · {review.delivery.id}.
                </Typography>
              )}
              {error && <Alert severity="error">{error}</Alert>}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button autoFocus disabled={busy} onClick={() => setReview(null)}>
              Cancel
            </Button>
            <Button disabled={busy} variant="contained" onClick={() => void confirm()}>
              {busy ? 'Submitting…' : labels[review.kind]}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Stack>
  );
}
