import { useEffect, useRef, useState } from 'react';
import { Box, Button, Checkbox, FormControlLabel, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { Alert } from '@omnitron-dev/prism/components/alert';
import type {
  FlowDefinition,
  FlowEvent,
  FlowNode,
  FlowNodeDescriptor,
  FlowPreview,
  FlowScalar,
} from '@omnitron-dev/omnitron/dto/services';
import { flows } from 'src/netron/client';
import { ScalarInput, validFlowKey } from './flow-inspector';

export interface ReviewedEvent {
  event: FlowEvent;
  result: FlowPreview;
}
const newField = (name = '', value: FlowScalar = '') => ({ id: crypto.randomUUID(), name, value });
const sampleType = (source?: FlowNode) =>
  source?.type === 'host.disk@1'
    ? 'host.disk.sample'
    : source?.type === 'input.manual@1'
      ? 'manual'
      : String(source?.config['eventType'] ?? '');
const initialFields = (source?: FlowNode) =>
  source?.type === 'host.disk@1' ? [newField('freeBytes', 5 * 1024 ** 3), newField('totalBytes', 100 * 1024 ** 3)] : [];
const effectLabel = {
  notification: 'Local notification',
  'pipeline-review': 'Request pipeline review',
  'pipeline-run': 'Run reviewed pipeline',
  'studio-task': 'Assign Studio task',
};

export function FlowEffects({ result }: { result: FlowPreview }) {
  const linear =
    result.traversed.length === result.visited.length - 1 &&
    result.traversed.every((edge, i) => edge.from === result.visited[i] && edge.to === result.visited[i + 1]);
  return (
    <Stack spacing={1} aria-label="Expected effects">
      <Typography variant="body2">
        {linear ? 'Path · ' + result.visited.join(' → ') : 'Visited · ' + result.visited.join(', ')}
      </Typography>
      {!linear &&
        result.traversed.map((edge) => (
          <Typography key={[edge.from, edge.port, edge.to].join(':')} variant="caption">
            {edge.from} · {edge.port} → {edge.to}
          </Typography>
        ))}
      {result.effects.length ? (
        result.effects.map((effect, index) => (
          <Box
            key={effect.nodeId + index}
            sx={{ pl: 1.25, borderLeft: 2, borderColor: 'success.main', overflowWrap: 'anywhere' }}
          >
            <Typography variant="subtitle2">
              {effectLabel[effect.kind] ?? effect.kind} · {effect.nodeId}
            </Typography>
            {Object.entries(effect.config).map(([key, value]) => (
              <Typography key={key} variant="caption" component="div">
                {key} · {String(value)}
              </Typography>
            ))}
            {Object.keys(effect.data).length > 0 && (
              <Typography variant="caption" component="div">
                Event data · {JSON.stringify(effect.data)}
              </Typography>
            )}
          </Box>
        ))
      ) : (
        <Typography variant="body2" color="text.secondary">
          This sample produces no effects.
        </Typography>
      )}
    </Stack>
  );
}

export function FlowSample({
  definition,
  catalog,
  onPreview,
  approved,
}: {
  definition: FlowDefinition;
  catalog: FlowNodeDescriptor[];
  onPreview(value: ReviewedEvent | null): void;
  approved: ReviewedEvent | null;
}) {
  const sources = definition.nodes.filter((node) =>
    catalog.some((item) => item.type === node.type && item.group === 'source')
  );
  const [selected, setSelected] = useState(sources[0]?.id ?? '');
  const source = sources.find((item) => item.id === selected) ?? sources[0];
  const [type, setType] = useState(() => sampleType(source));
  const [fields, setFields] = useState(() => initialFields(source));
  const [carryFrom, setCarryFrom] = useState<FlowDefinition | null>(null);
  const [last, setPrevious] = useState<{ definition: FlowDefinition; state: FlowPreview['state'] }>();
  const previous = last?.definition === definition ? last.state : undefined;
  const carry = carryFrom === definition;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const version = useRef(0);
  const latest = useRef(definition);
  latest.current = definition;
  useEffect(
    () => () => {
      version.current++;
    },
    []
  );
  const invalidate = () => {
    version.current++;
    onPreview(null);
    setError('');
  };
  const preview = async () => {
    if (!source) return;
    invalidate();
    const request = version.current;
    const prior = definition;
    setBusy(true);
    try {
      if (!type.trim()) throw Error('Enter an event type.');
      if (
        fields.some((field) => !validFlowKey(field.name)) ||
        new Set(fields.map((field) => field.name)).size !== fields.length
      )
        throw Error('Every sample field needs a unique name starting with a letter.');
      if (fields.some((field) => typeof field.value === 'number' && !Number.isFinite(field.value)))
        throw Error('Enter a finite number for each numeric field.');
      const event: FlowEvent = {
        id: crypto.randomUUID(),
        source: source.id,
        type,
        data: Object.fromEntries(fields.map((field) => [field.name, field.value])),
      };
      const result = await flows.preview({ definition, event, ...(carry && previous && { state: previous }) });
      if (request === version.current && prior === latest.current) {
        onPreview({ event, result });
        setPrevious({ definition, state: result.state });
      }
    } catch (failure) {
      if (request === version.current && prior === latest.current)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  const selectedSource = (id: string) => {
    invalidate();
    const next = sources.find((item) => item.id === id);
    setSelected(id);
    setType(sampleType(next));
    setFields(initialFields(next));
    setPrevious(undefined);
    setCarryFrom(null);
  };
  return (
    <Stack spacing={1.5} aria-label="Test event">
      <Typography variant="subtitle2">Test event</Typography>
      {!sources.length ? (
        <Typography variant="body2" color="text.secondary">
          Add an event source to preview this flow.
        </Typography>
      ) : (
        <>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField
              select
              fullWidth
              size="small"
              label="Event source"
              value={source!.id}
              onChange={(e) => selectedSource(e.target.value)}
            >
              {sources.map((item) => (
                <MenuItem key={item.id} value={item.id}>
                  {item.id}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              fullWidth
              size="small"
              label="Event type"
              value={type}
              onChange={(e) => {
                invalidate();
                setType(e.target.value);
              }}
            />
          </Stack>
          {fields.map((field, index) => (
            <Stack
              key={field.id}
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{ alignItems: { sm: 'center' } }}
            >
              <TextField
                size="small"
                label={'Field ' + (index + 1) + ' name'}
                value={field.name}
                sx={{ flex: 1 }}
                onChange={(e) => {
                  invalidate();
                  setFields(fields.map((item) => (item.id === field.id ? { ...item, name: e.target.value } : item)));
                }}
              />
              <ScalarInput
                label={'Field ' + (index + 1) + ' value'}
                value={field.value}
                onChange={(value) => {
                  invalidate();
                  setFields(fields.map((item) => (item.id === field.id ? { ...item, value } : item)));
                }}
              />
              <Button
                size="small"
                aria-label={'Remove event field ' + (index + 1)}
                onClick={() => {
                  invalidate();
                  setFields(fields.filter((item) => item.id !== field.id));
                }}
              >
                Remove
              </Button>
            </Stack>
          ))}
          <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <Button
              size="small"
              disabled={fields.length >= 32}
              onClick={() => {
                invalidate();
                setFields([...fields, newField()]);
              }}
            >
              Add event field
            </Button>
            {previous && Object.keys(previous).length > 0 && (
              <FormControlLabel
                label="Use previous preview state"
                control={
                  <Checkbox
                    size="small"
                    checked={carry}
                    onChange={(_, checked) => {
                      invalidate();
                      setCarryFrom(checked ? definition : null);
                    }}
                  />
                }
              />
            )}
            <Button size="small" variant="outlined" disabled={busy} onClick={() => void preview()}>
              {busy ? 'Previewing…' : 'Preview event'}
            </Button>
          </Stack>
        </>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {approved && <FlowEffects result={approved.result} />}
    </Stack>
  );
}
