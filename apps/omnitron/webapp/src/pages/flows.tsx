import { useEffect, useRef, useState } from 'react';
import { Link as RouterLink, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Button, Chip, LinearProgress, Paper, Stack, TextField, Typography } from '@mui/material';
import { Alert } from '@omnitron-dev/prism/components/alert';
import {
  diskSpaceFlow,
  type FlowDefinition,
  type FlowNodeDescriptor,
  type FlowListCursor,
  type FlowWorkspace,
  type SavedFlow,
} from '@omnitron-dev/omnitron/dto/services';
import { useAccess } from 'src/auth/access';
import { FlowGraph, canWire } from 'src/components/flow-graph';
import { FlowInspector, flowFieldError } from 'src/components/flow-inspector';
import { describeFlowError, FlowOperations } from 'src/components/flow-operations';
import { FlowSample, type ReviewedEvent } from 'src/components/flow-sample';
import { Breadcrumbs } from 'src/components/page-breadcrumbs';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { flows, studio } from 'src/netron/client';
import { flowHref, useWorkspace, workspaceHref } from 'src/routes/workspace';
import { formatDate } from 'src/utils/formatters';

const panel = { p: { xs: 1.5, sm: 2 }, minWidth: 0 };
const groupNames = { source: 'Event sources', transform: 'Transforms', decision: 'Decisions', output: 'Outputs' };
const diskTemplate = () => diskSpaceFlow('/', 10 * 1024 ** 3, 15 * 1024 ** 3);
const blankTemplate = (): FlowDefinition => ({ version: 1, name: '', nodes: [], edges: [] });

function readCursor(value: string | null): FlowListCursor | undefined {
  const match = value?.match(/^(\d{1,16}),([a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12})$/i);
  const updatedAt = Number(match?.[1]);
  return match && Number.isSafeInteger(updatedAt) ? { updatedAt, id: match[2]! } : undefined;
}

export default function FlowsPage() {
  const { project, stack } = useWorkspace();
  const { snapshot } = useAccess();
  const workspace = { project, ...(project && stack && { stack }) };
  return <FlowWorkspacePage key={JSON.stringify([snapshot?.userId, project, stack])} workspace={workspace} />;
}

function FlowWorkspacePage({ workspace }: { workspace: FlowWorkspace }) {
  const { can } = useAccess();
  const [search] = useSearchParams();
  const { key: locationKey } = useLocation();
  const editorLocation = useRef<string | null>(locationKey);
  useEffect(() => {
    editorLocation.current = locationKey;
    return () => {
      editorLocation.current = null;
    };
  }, [locationKey]);
  const navigate = useNavigate();
  const [confirmed, setConfirmed] = useState<{ entry: SavedFlow; prior: SavedFlow | null; location: string } | null>(
    null
  );
  const id = search.get('flow'),
    seed = search.get('new'),
    team = search.get('team'),
    proposal = search.get('proposal');
  const editing = !!(id || seed || team || proposal);
  const ambiguous = [!!id, !!seed, !!team || !!proposal].filter(Boolean).length > 1;
  const rawCursor = search.get('before');
  const before = readCursor(rawCursor);
  const invalidCursor = rawCursor !== null && !before;
  const mayList = can('OmnitronFlows.list');
  const mayRead = can('OmnitronFlows.get');
  const inventory = usePolledResource(() => flows.list({ workspace, ...(before && { before }) }), {
    intervalMs: 10000,
    enabled: !editing && !invalidCursor && mayList,
    paused: !!before,
    resourceKey: rawCursor,
  });
  const detail = usePolledResource(() => flows.get({ workspace, id: id! }), {
    intervalMs: 10000,
    enabled: !!id && !ambiguous && mayRead,
    resourceKey: id,
  });
  const library = usePolledResource(() => flows.catalog(), {
    intervalMs: 0,
    paused: true,
    enabled: can('OmnitronFlows.catalog'),
  });
  const proposalAccess = can('OmnitronStudio.flowProposal');
  const proposed = usePolledResource(
    () => studio.flowProposal({ project: workspace.project, threadId: team!, proposalId: proposal! }),
    {
      intervalMs: 0,
      paused: true,
      resourceKey: JSON.stringify([team, proposal]),
      enabled: !!team && !!proposal && !ambiguous && proposalAccess,
    }
  );
  const lastSave =
    confirmed && (id ? confirmed.entry.id === id : !mayRead && confirmed.location === locationKey) ? confirmed : null;
  const saved =
    lastSave && (!detail.data || lastSave.prior === detail.data || lastSave.entry.updatedAt > detail.data.updatedAt)
      ? lastSave.entry
      : detail.data;
  const catalog = library.data?.nodes ?? [];
  const hasTemplate = diskTemplate().nodes.every((n) => catalog.some((item) => item.type === n.type));
  const canEdit = can('OmnitronFlows.catalog') && (can('OmnitronFlows.preview') || can('OmnitronFlows.save'));
  const home = flowHref(workspace);
  let issue = '';
  let definition: FlowDefinition | null = null;
  if (ambiguous) issue = 'Choose one saved flow, template or team proposal.';
  else if (id) {
    if (saved) {
      if (
        saved.workspace.project !== workspace.project ||
        (saved.workspace.stack ?? null) !== (workspace.stack ?? null)
      )
        return <Navigate replace to={flowHref(saved.workspace, { flow: saved.id })} />;
      definition = saved.definition;
    } else if (!mayRead || (!detail.loading && !detail.error))
      issue = 'This flow is unavailable in the selected workspace.';
  } else if (team || proposal) {
    if (!team || !proposal || !proposalAccess)
      issue = 'This proposal is unavailable. Open the proposal from its Studio team.';
    else if (proposed.data) {
      if (proposed.data.stack !== (workspace.stack ?? null))
        return (
          <Navigate
            replace
            to={flowHref(
              { project: workspace.project, ...(proposed.data.stack && { stack: proposed.data.stack }) },
              { team, proposal }
            )}
          />
        );
      definition = proposed.data.definition;
    }
  } else if (seed) {
    if (!canEdit) issue = 'Creating flow drafts is unavailable for this account.';
    else if (seed === 'blank') definition = blankTemplate();
    else if (seed === 'disk' && hasTemplate) definition = diskTemplate();
    else if (!library.loading) issue = 'This template is unavailable in the controller catalog.';
  }
  const record = (next: SavedFlow) => {
    if (editorLocation.current !== locationKey) return;
    setConfirmed({ entry: next, prior: detail.data, location: locationKey });
    if (next.id === id && mayRead) void detail.refresh();
    else if (mayRead) void navigate(flowHref(next.workspace, { flow: next.id }), { replace: true });
  };
  const errors = [
    [!editing && inventory.error, inventory.refresh],
    [id && detail.error, detail.refresh],
    [library.error, library.refresh],
    [proposal && proposed.error, proposed.refresh],
  ] as const;
  const title = definition?.name || (seed === 'blank' ? 'New flow' : 'Flow editor');
  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <Breadcrumbs
        links={
          editing
            ? [
                { name: 'Flows', ...((can('OmnitronFlows.list') || can('OmnitronFlows.catalog')) && { href: home }) },
                { name: title },
              ]
            : [{ name: 'Flows' }]
        }
      />
      {errors.map(
        ([error, retry], index) =>
          error && (
            <Alert key={index} severity="error" action={<Button onClick={() => void retry()}>Retry</Button>}>
              {error}
            </Alert>
          )
      )}
      {!!library.data?.diagnostics.length && (
        <Alert severity="warning">
          <Typography variant="subtitle2">Controller component catalog</Typography>
          {library.data.diagnostics.map((message, i) => (
            <Typography variant="body2" key={i} sx={{ overflowWrap: 'anywhere' }}>
              {message}
            </Typography>
          ))}
        </Alert>
      )}
      {issue ? (
        <Alert severity="warning">{issue}</Alert>
      ) : editing ? (
        definition && (!can('OmnitronFlows.catalog') || !library.loading) ? (
          <FlowEditor
            key={JSON.stringify([id, seed, team, proposal])}
            workspace={workspace}
            saved={saved}
            initial={definition}
            catalog={catalog}
            record={record}
            canEdit={canEdit}
            readFailed={!!id && !!detail.error}
            proposalLink={
              team && proposal && can('OmnitronStudio.thread')
                ? workspaceHref(
                    { project: workspace.project, stack: workspace.stack ?? null },
                    '/studio?' + new URLSearchParams({ team })
                  )
                : null
            }
          />
        ) : (
          !errors.some(([error]) => !!error) && <LinearProgress aria-label="Loading flow" />
        )
      ) : (
        <>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <Typography variant="h6" sx={{ flex: 1 }}>
              {mayList ? 'Saved flows' : 'Node library'}
            </Typography>
            {canEdit && (
              <>
                <Button
                  component={RouterLink}
                  to={flowHref(workspace, { new: 'blank' })}
                  variant="contained"
                  size="small"
                >
                  New flow
                </Button>
                {hasTemplate && (
                  <Button
                    component={RouterLink}
                    to={flowHref(workspace, { new: 'disk' })}
                    variant="outlined"
                    size="small"
                  >
                    Disk space template
                  </Button>
                )}
              </>
            )}
          </Stack>
          {!mayList && catalog.length > 0 && (
            <Paper variant="outlined" sx={panel}>
              <Stack spacing={1}>
                {Object.entries(groupNames).map(([group, label]) => (
                  <Box key={group}>
                    <Typography variant="subtitle2">{label}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {catalog
                        .filter((item) => item.group === group)
                        .map((item) => item.label)
                        .join(' · ')}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </Paper>
          )}
          {mayList && (
            <Paper variant="outlined" sx={panel}>
              {invalidCursor && <Alert severity="warning">This inventory page has an invalid cursor.</Alert>}
              {!invalidCursor && inventory.loading && !inventory.data && (
                <LinearProgress aria-label="Loading flow inventory" />
              )}
              {inventory.data?.items.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  {before ? 'No older flows in this workspace.' : 'No saved flows in this workspace.'}
                </Typography>
              )}
              {inventory.data?.items.map((item) => (
                <Stack
                  key={item.id}
                  direction="row"
                  spacing={1}
                  useFlexGap
                  sx={{ alignItems: 'center', flexWrap: 'wrap', py: 0.5 }}
                >
                  {mayRead ? (
                    <Button
                      component={RouterLink}
                      to={flowHref(item.workspace, { flow: item.id })}
                      size="small"
                      sx={{ overflowWrap: 'anywhere', textAlign: 'start' }}
                    >
                      {item.name}
                    </Button>
                  ) : (
                    <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                      {item.name}
                    </Typography>
                  )}
                  <Chip size="small" label={item.active ? 'Active' : 'Paused'} />
                  <Typography variant="caption" color="text.secondary">
                    {item.workspace.stack && item.workspace.stack + ' · '}
                    {formatDate(new Date(item.updatedAt))}
                  </Typography>
                </Stack>
              ))}
              {(rawCursor !== null || inventory.data?.next) && (
                <Stack
                  component="nav"
                  aria-label="Flow inventory pages"
                  direction="row"
                  useFlexGap
                  spacing={1}
                  sx={{ flexWrap: 'wrap', mt: 1 }}
                >
                  {rawCursor !== null && (
                    <Button size="small" component={RouterLink} to={home}>
                      Latest flows
                    </Button>
                  )}
                  {inventory.data?.next && (
                    <Button
                      size="small"
                      component={RouterLink}
                      to={flowHref(workspace, { before: inventory.data.next.updatedAt + ',' + inventory.data.next.id })}
                    >
                      Older flows
                    </Button>
                  )}
                </Stack>
              )}
            </Paper>
          )}
        </>
      )}
    </Stack>
  );
}

function FlowEditor({
  workspace,
  saved,
  initial,
  catalog,
  record,
  canEdit,
  readFailed,
  proposalLink,
}: {
  workspace: FlowWorkspace;
  saved: SavedFlow | null;
  initial: FlowDefinition;
  catalog: FlowNodeDescriptor[];
  record(flow: SavedFlow): void;
  canEdit: boolean;
  readFailed: boolean;
  proposalLink: string | null;
}) {
  const { can } = useAccess();
  const [id] = useState(() => saved?.id ?? crypto.randomUUID());
  const [baseline, setBaseline] = useState(saved);
  const [definition, setDefinition] = useState(initial);
  const [selected, setSelected] = useState<string | null>(initial.nodes[0]?.id ?? null);
  const [component, setComponent] = useState(
    catalog.find((item) => item.group === 'source')?.type ?? catalog[0]?.type ?? ''
  );
  const [sample, setSample] = useState<ReviewedEvent | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const node = definition.nodes.find((item) => item.id === selected);
  const dirty = !baseline || definition !== baseline.definition;
  const changed = saved && baseline && saved.revision !== baseline.revision;
  const change = (next: FlowDefinition) => {
    if (canEdit) {
      setDefinition(next);
      setSample(null);
      setError('');
    }
  };
  const load = (entry: SavedFlow) => {
    setBaseline(entry);
    setDefinition(entry.definition);
    setSample(null);
    setError('');
    if (!entry.definition.nodes.some((n) => n.id === selected)) setSelected(entry.definition.nodes[0]?.id ?? null);
  };
  const save = async () => {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      if (!definition.name.trim()) throw Error('Enter a flow name.');
      for (const item of definition.nodes) {
        const descriptor = catalog.find((d) => d.type === item.type);
        if (!descriptor) {
          setSelected(item.id);
          throw Error('Controller component unavailable · ' + item.type);
        }
        const invalid = descriptor.fields.find((field) => flowFieldError(field, item.config[field.key]));
        if (invalid) {
          setSelected(item.id);
          throw Error(item.id + ' · ' + invalid.label + ' · ' + flowFieldError(invalid, item.config[invalid.key]));
        }
      }
      const entry = await flows.save({ workspace, id, definition, expectedRevision: baseline?.revision ?? null });
      load(entry);
      record(entry);
    } catch (failure) {
      setError(describeFlowError(failure));
    } finally {
      setBusy(false);
    }
  };
  const add = () => {
    const item = catalog.find((d) => d.type === component);
    if (!item) return;
    const base = item.type.split('@')[0]!.split('.').at(-1)!;
    let nodeId = base,
      suffix = 1;
    while (definition.nodes.some((n) => n.id === nodeId)) nodeId = base + ++suffix;
    const config = Object.fromEntries(
      item.fields.map((f) => [f.key, f.type === 'number' ? (f.min ?? 0) : f.type === 'fields' ? [] : ''])
    );
    change({ ...definition, nodes: [...definition.nodes, { id: nodeId, type: item.type, config }] });
    setSelected(nodeId);
  };
  const sourcesKey = JSON.stringify(
    definition.nodes
      .filter((n) => catalog.find((item) => item.type === n.type)?.group === 'source')
      .map((n) => [n.id, n.type, n.config])
  );
  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      {proposalLink && (
        <Box>
          <Button component={RouterLink} size="small" to={proposalLink}>
            Open Studio team
          </Button>
        </Box>
      )}
      {changed && (
        <Alert severity="warning" action={<Button onClick={() => load(saved)}>Load latest draft</Button>}>
          A newer draft is available. Loading it replaces the changes in this editor.
        </Alert>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      <Paper variant="outlined" sx={panel}>
        <Stack spacing={1.75} inert={busy}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
            <TextField
              size="small"
              label="Flow name"
              fullWidth
              value={definition.name}
              slotProps={{ input: { readOnly: !canEdit }, htmlInput: { maxLength: 120 } }}
              onChange={(e) => change({ ...definition, name: e.target.value })}
            />
            {canEdit && can('OmnitronFlows.save') && (
              <Button
                variant="contained"
                size="small"
                sx={{ whiteSpace: 'nowrap', alignSelf: { xs: 'start', sm: 'center' } }}
                disabled={readFailed || !!changed || busy}
                onClick={() => void save()}
              >
                {busy ? 'Saving…' : 'Save draft'}
              </Button>
            )}
          </Stack>
          {canEdit && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
              <TextField
                select
                size="small"
                label="Node library"
                fullWidth
                value={component}
                onChange={(e) => setComponent(e.target.value)}
                slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
              >
                {Object.entries(groupNames).map(([group, label]) => (
                  <optgroup key={group} label={label}>
                    {catalog
                      .filter((item) => item.group === group)
                      .map((item) => (
                        <option key={item.type} value={item.type}>
                          {item.label}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </TextField>
              <Button
                variant="outlined"
                size="small"
                disabled={!component || definition.nodes.length >= 64}
                onClick={add}
                sx={{ whiteSpace: 'nowrap', alignSelf: { xs: 'start', sm: 'center' } }}
              >
                Add node
              </Button>
            </Stack>
          )}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'minmax(0,1.7fr) minmax(250px,1fr)' },
              gap: 2,
            }}
          >
            <FlowGraph
              editable={canEdit}
              definition={definition}
              catalog={catalog}
              selected={selected}
              preview={sample?.result ?? null}
              onSelect={setSelected}
              onConnect={(edge) => {
                if (canWire(definition, catalog, edge.from, edge.port, edge.to))
                  change({ ...definition, edges: [...definition.edges, edge] });
              }}
              onDisconnect={(edge) =>
                change({ ...definition, edges: definition.edges.filter((wire) => wire !== edge) })
              }
            />
            <Stack spacing={1.5} aria-label="Node inspector" sx={{ minWidth: 0 }}>
              <TextField
                select
                size="small"
                label="Inspect node"
                value={node?.id ?? ''}
                onChange={(e) => setSelected(e.target.value)}
                slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
              >
                {!definition.nodes.length && <option value="">No nodes</option>}
                {definition.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.id}
                  </option>
                ))}
              </TextField>
              {node && canEdit && (
                <FlowInspector
                  key={node.id}
                  definition={definition}
                  catalog={catalog}
                  node={node}
                  change={change}
                  select={setSelected}
                />
              )}
              {node && !canEdit && (
                <>
                  <Typography variant="subtitle2">
                    {catalog.find((item) => item.type === node.type)?.label ?? node.type}
                  </Typography>
                  {Object.entries(node.config).map(([k, v]) => (
                    <Typography key={k} variant="body2">
                      {k} · {String(v)}
                    </Typography>
                  ))}
                </>
              )}
            </Stack>
          </Box>
        </Stack>
      </Paper>
      {can('OmnitronFlows.preview') && (
        <Paper variant="outlined" sx={panel}>
          <FlowSample
            key={sourcesKey}
            definition={definition}
            catalog={catalog}
            onPreview={setSample}
            approved={sample}
          />
        </Paper>
      )}
      {saved && !readFailed && (
        <Paper variant="outlined" sx={panel}>
          <FlowOperations
            saved={saved}
            catalog={catalog}
            current={!dirty && !changed}
            sample={sample}
            setSaved={record}
          />
        </Paper>
      )}
    </Stack>
  );
}
