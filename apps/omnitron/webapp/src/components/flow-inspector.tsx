import { useState } from 'react';
import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import type {
  FlowDefinition,
  FlowField,
  FlowNode,
  FlowNodeDescriptor,
  FlowScalar,
} from '@omnitron-dev/omnitron/dto/services';
import { canWire, edgeKey } from './flow-graph';

const fieldName = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;
export const validFlowKey = (value: string) =>
  fieldName.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);

export function flowFieldError(field: FlowField, value: unknown): string | null {
  if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'Enter a finite number.';
    if (field.min != null && value < field.min) return 'Minimum ' + field.min + '.';
    if (field.max != null && value > field.max) return 'Maximum ' + field.max + '.';
  } else if (field.type === 'fields') {
    if (
      !Array.isArray(value) ||
      !value.length ||
      value.length > 32 ||
      value.some((key) => typeof key !== 'string' || !validFlowKey(key)) ||
      new Set(value).size !== value.length
    )
      return 'Enter 1–32 distinct field names separated by commas.';
  } else if (field.type === 'text') {
    if (typeof value !== 'string' || !value.trim()) return 'Enter a value.';
    if (value.length > 2048 || value.includes('\0')) return 'Enter up to 2,048 text characters.';
  } else if (field.type === 'scalar' && typeof value === 'number' && !Number.isFinite(value))
    return 'Enter a finite number.';
  else if (field.type === 'scalar' && typeof value === 'string' && value.length > 4096)
    return 'Enter up to 4,096 characters.';
  return null;
}

export function ScalarInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: FlowScalar;
  onChange(value: FlowScalar): void;
}) {
  const type = value === null ? 'null' : typeof value;
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ minWidth: 0, flex: 1 }}>
      <TextField
        select
        size="small"
        label={label + ' type'}
        value={type}
        sx={{ minWidth: 104 }}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next === 'null' ? null : next === 'boolean' ? true : next === 'number' ? 0 : '');
        }}
      >
        {['string', 'number', 'boolean', 'null'].map((item) => (
          <MenuItem key={item} value={item}>
            {item}
          </MenuItem>
        ))}
      </TextField>
      {type === 'boolean' ? (
        <TextField
          select
          size="small"
          label={label}
          value={String(value)}
          fullWidth
          onChange={(event) => onChange(event.target.value === 'true')}
        >
          <MenuItem value="true">true</MenuItem>
          <MenuItem value="false">false</MenuItem>
        </TextField>
      ) : (
        type !== 'null' && (
          <TextField
            size="small"
            fullWidth
            type={type === 'number' ? 'number' : 'text'}
            label={label}
            value={typeof value === 'number' && !Number.isFinite(value) ? '' : String(value)}
            error={typeof value === 'number' && !Number.isFinite(value)}
            onChange={(event) => {
              const input = event.target.value;
              onChange(type !== 'number' ? input : input === '' ? Number.NaN : Number(input));
            }}
          />
        )
      )}
    </Stack>
  );
}

function ConfigField({ field, node, update }: { field: FlowField; node: FlowNode; update(value: unknown): void }) {
  const value = node.config[field.key];
  const error = flowFieldError(field, value);
  if (field.type === 'scalar')
    return <ScalarInput label={field.label} value={(value ?? null) as FlowScalar} onChange={update} />;
  const display = Array.isArray(value) ? value.join(', ') : String(value ?? '');
  return (
    <TextField
      label={field.label}
      fullWidth
      size="small"
      type={field.type === 'number' ? 'number' : 'text'}
      value={display}
      error={!!error}
      helperText={error ?? (field.type === 'fields' ? 'Comma-separated event fields.' : undefined)}
      slotProps={{ htmlInput: { min: field.min, max: field.max } }}
      onChange={(event) => {
        const input = event.target.value;
        update(
          field.type === 'fields'
            ? input.split(',').map((key) => key.trim())
            : field.type === 'number' && input !== ''
              ? Number(input)
              : input
        );
      }}
    />
  );
}

export function FlowInspector({
  definition,
  catalog,
  node,
  change,
  select,
}: {
  definition: FlowDefinition;
  catalog: FlowNodeDescriptor[];
  node: FlowNode;
  change(next: FlowDefinition): void;
  select(id: string | null): void;
}) {
  const descriptor = catalog.find((item) => item.type === node.type);
  const [id, setId] = useState(node.id);
  const [port, setPort] = useState(descriptor?.ports[0] ?? '');
  const [target, setTarget] = useState('');
  const [error, setError] = useState('');
  const outlets = descriptor?.ports ?? [];
  const available = definition.nodes.filter((item) => canWire(definition, catalog, node.id, port, item.id));
  const destination = available.some((item) => item.id === target) ? target : '';
  const wires = definition.edges.filter((edge) => edge.from === node.id || edge.to === node.id);
  const rename = () => {
    if (id === node.id) return;
    if (!validFlowKey(id) || definition.nodes.some((item) => item.id === id)) {
      setError('Choose a unique node ID starting with a letter.');
      return;
    }
    change({
      ...definition,
      nodes: definition.nodes.map((item) => (item.id === node.id ? { ...item, id } : item)),
      edges: definition.edges.map((edge) => ({
        ...edge,
        from: edge.from === node.id ? id : edge.from,
        to: edge.to === node.id ? id : edge.to,
      })),
    });
    select(id);
  };
  return (
    <Stack spacing={1.4} sx={{ minWidth: 0 }}>
      <Typography variant="subtitle2">{descriptor?.label ?? node.type}</Typography>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'start' }}>
        <TextField
          label="Node ID"
          size="small"
          value={id}
          fullWidth
          onChange={(event) => {
            setId(event.target.value);
            setError('');
          }}
          error={!!error}
          helperText={error || undefined}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              rename();
            }
          }}
        />
        {id !== node.id && (
          <Button size="small" onClick={rename}>
            Rename
          </Button>
        )}
      </Stack>
      {!descriptor && <Alert severity="warning">This node type is unavailable in the controller catalog.</Alert>}
      {descriptor?.fields.map((field) => (
        <ConfigField
          key={field.key}
          field={field}
          node={node}
          update={(value) =>
            change({
              ...definition,
              nodes: definition.nodes.map((item) =>
                item.id !== node.id ? item : { ...item, config: { ...item.config, [field.key]: value } }
              ),
            })
          }
        />
      ))}
      {!!outlets.length && (
        <>
          <Typography variant="subtitle2">Connect output</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField
              label="Output port"
              select
              fullWidth
              size="small"
              value={port}
              onChange={(event) => {
                setPort(event.target.value);
                setTarget('');
              }}
            >
              {outlets.map((name) => (
                <MenuItem key={name} value={name}>
                  {name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Target node"
              select
              fullWidth
              size="small"
              value={destination}
              onChange={(event) => setTarget(event.target.value)}
            >
              <MenuItem value="">Choose a node</MenuItem>
              {available.map((item) => (
                <MenuItem key={item.id} value={item.id}>
                  {item.id}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <Button
            sx={{ alignSelf: 'start' }}
            variant="outlined"
            size="small"
            disabled={!destination}
            onClick={() => {
              if (canWire(definition, catalog, node.id, port, destination))
                change({ ...definition, edges: [...definition.edges, { from: node.id, port, to: destination }] });
              setTarget('');
            }}
          >
            Connect nodes
          </Button>
        </>
      )}
      {wires.map((edge) => (
        <Stack key={edgeKey(edge)} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="caption" sx={{ flex: 1, overflowWrap: 'anywhere' }}>
            {edge.from} · {edge.port} → {edge.to}
          </Typography>
          <Button
            size="small"
            aria-label={'Disconnect ' + edge.from + ' ' + edge.port + ' from ' + edge.to}
            onClick={() => change({ ...definition, edges: definition.edges.filter((item) => item !== edge) })}
          >
            Disconnect
          </Button>
        </Stack>
      ))}
      <Box>
        <Button
          size="small"
          color="error"
          onClick={() => {
            const remaining = definition.nodes.filter((item) => item.id !== node.id);
            change({
              ...definition,
              nodes: remaining,
              edges: definition.edges.filter((edge) => edge.from !== node.id && edge.to !== node.id),
            });
            select(remaining[0]?.id ?? null);
          }}
        >
          Remove node
        </Button>
      </Box>
    </Stack>
  );
}
