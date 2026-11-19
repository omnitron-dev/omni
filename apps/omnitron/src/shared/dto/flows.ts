/** A flow is data. Installed node implementations stay on the controller. */
export type FlowScalar = string | number | boolean | null;
export type FlowData = Record<string, FlowScalar>;
export interface FlowNode {
  id: string;
  type: string;
  config: Record<string, unknown>;
}
export interface FlowDefinition {
  version: 1;
  name: string;
  nodes: FlowNode[];
  edges: { from: string; port: string; to: string }[];
}
export interface FlowEvent {
  id: string;
  source: string;
  type: string;
  data: FlowData;
}
export interface FlowEffect {
  nodeId: string;
  kind: 'notification' | 'pipeline-review' | 'pipeline-run' | 'studio-task';
  config: Record<string, unknown>;
  data: FlowData;
}
export type FlowState = Record<string, boolean>;
export interface FlowPreview {
  state: FlowState;
  visited: string[];
  traversed: FlowDefinition['edges'];
  effects: FlowEffect[];
}
export interface FlowField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'fields' | 'scalar';
  min?: number;
  max?: number;
}
export interface FlowNodeDescriptor {
  type: string;
  label: string;
  group: 'source' | 'transform' | 'decision' | 'output';
  fields: FlowField[];
  ports: string[];
}
interface Delivery {
  port: string;
  data: FlowData;
}
interface FlowDecision {
  deliveries?: Delivery[];
  state?: boolean;
  effect?: FlowEffect['kind'];
}
export interface FlowComponent extends FlowNodeDescriptor {
  implementationRevision?: string;
  validate?(config: Record<string, unknown>): void;
  accepts?(config: Record<string, unknown>, type: string): boolean;
  evaluate(config: Record<string, unknown>, data: FlowData, previous?: boolean): FlowDecision;
}

const keyPattern = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const validKey = (value: unknown): value is string =>
  typeof value === 'string' && keyPattern.test(value) && !forbidden.has(value);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((name) => Object.hasOwn(value, name));
const scalar = (value: unknown): value is FlowScalar =>
  value === null ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value)) ||
  (typeof value === 'string' && value.length <= 4096);
const deliver = (port: string, data: FlowData): FlowDecision => ({ deliveries: [{ port, data }] });
const textField = (key: string, label: string): FlowField => ({ key, label, type: 'text' });
const numericField = (key: string, label: string, min?: number, max?: number): FlowField => ({
  key,
  label,
  type: 'number',
  ...(min === undefined ? {} : { min }),
  ...(max === undefined ? {} : { max }),
});
const fieldParam = textField('field', 'Event field');

function validateField(config: Record<string, unknown>) {
  if (!validKey(config['field'])) throw Error('Choose a valid event field');
}
function dataFields(data: unknown): asserts data is FlowData {
  if (
    !record(data) ||
    Object.keys(data).length > 32 ||
    Object.entries(data).some(([k, v]) => !validKey(k) || !scalar(v)) ||
    JSON.stringify(data).length > 16384
  )
    throw Error('An event must contain at most 32 named scalar fields and 16 KiB of data');
}
const source = (
  type: string,
  label: string,
  fields: FlowField[],
  accepts: NonNullable<FlowComponent['accepts']>,
  validate?: FlowComponent['validate']
): FlowComponent => ({
  type,
  label,
  group: 'source',
  fields,
  ports: ['event'],
  accepts,
  ...(validate && { validate }),
  evaluate: (_c, data) => deliver('event', data),
});
const output = (type: string, label: string, fields: FlowField[], effect: FlowEffect['kind']): FlowComponent => ({
  type,
  label,
  group: 'output',
  fields,
  ports: [],
  evaluate: () => ({ effect }),
});

const builtins: FlowComponent[] = [
  source('input.manual@1', 'Manual input', [], (_c, t) => t === 'manual'),
  source('input.event@1', 'Incoming event', [textField('eventType', 'Event type')], (c, t) => t === c['eventType']),
  source(
    'host.disk@1',
    'Disk free space',
    [textField('path', 'Volume path'), numericField('intervalMs', 'Sample interval (ms)', 1000, 86400000)],
    (_c, t) => t === 'host.disk.sample',
    (c) => {
      if (!/^(?:\/|[A-Za-z]:[\\/])/.test(String(c['path'])) || !Number.isSafeInteger(c['intervalMs']))
        throw Error('Choose an absolute volume path and a whole sampling interval');
    }
  ),
  {
    type: 'logic.threshold@1',
    label: 'Low threshold with recovery',
    group: 'decision',
    fields: [fieldParam, numericField('below', 'Enter below'), numericField('rearmAt', 'Recover at or above')],
    ports: ['low', 'recovered'],
    validate(c) {
      validateField(c);
      if (Number(c['rearmAt']) <= Number(c['below'])) throw Error('Recovery must be above the lower threshold');
    },
    evaluate(c, data, previous) {
      const value = data[String(c['field'])];
      if (typeof value !== 'number') throw Error('The threshold requires a numeric event field');
      if (!previous && value < Number(c['below'])) return { ...deliver('low', data), state: true };
      if (previous && value >= Number(c['rearmAt'])) return { ...deliver('recovered', data), state: false };
      return {};
    },
  },
  {
    type: 'logic.equals@1',
    label: 'Compare value',
    group: 'decision',
    fields: [fieldParam, { key: 'value', label: 'Value', type: 'scalar' }],
    ports: ['yes', 'no'],
    validate: validateField,
    evaluate: (c, data) =>
      deliver(Object.hasOwn(data, String(c['field'])) && data[String(c['field'])] === c['value'] ? 'yes' : 'no', data),
  },
  {
    type: 'data.select@1',
    label: 'Select fields',
    group: 'transform',
    fields: [{ key: 'fields', label: 'Fields to forward', type: 'fields' }],
    ports: ['data'],
    evaluate: (c, data) =>
      deliver(
        'data',
        Object.fromEntries((c['fields'] as string[]).filter((k) => Object.hasOwn(data, k)).map((k) => [k, data[k]!]))
      ),
  },
  {
    type: 'data.set@1',
    label: 'Set a value',
    group: 'transform',
    fields: [fieldParam, { key: 'value', label: 'Value', type: 'scalar' }],
    ports: ['data'],
    validate: validateField,
    evaluate: (c, data) => deliver('data', { ...data, [String(c['field'])]: c['value'] as FlowScalar }),
  },
  output('output.notify@1', 'Local notification', [textField('title', 'Title')], 'notification'),
  output(
    'output.pipeline@1',
    'Request pipeline review',
    [textField('pipelineId', 'Pipeline ID'), textField('revision', 'Expected revision')],
    'pipeline-review'
  ),
  output(
    'output.run-pipeline@1',
    'Run approved release pipeline',
    [textField('pipelineId', 'Pipeline ID'), textField('revision', 'Expected revision')],
    'pipeline-run'
  ),
  output(
    'output.studio@1',
    'Assign a Studio task',
    [textField('threadId', 'Team ID'), textField('memberId', 'Member ID'), textField('task', 'Assignment')],
    'studio-task'
  ),
];

/** Extensions are registered by trusted host code. Graphs select pinned component versions by name. */
export class FlowRegistry {
  private readonly components = new Map<string, FlowComponent>();
  constructor(components: readonly FlowComponent[] = builtins) {
    for (const component of components) this.register(component);
  }
  register(component: FlowComponent) {
    if (
      !/^[a-z][a-z0-9.-]{1,78}@[1-9][0-9]*$/.test(component.type) ||
      this.components.has(component.type) ||
      !['source', 'transform', 'decision', 'output'].includes(component.group) ||
      !component.label.trim() ||
      typeof component.evaluate !== 'function' ||
      (component.group === 'source' && typeof component.accepts !== 'function') ||
      new Set(component.ports).size !== component.ports.length ||
      component.ports.some((p) => !validKey(p)) ||
      new Set(component.fields.map((f) => f.key)).size !== component.fields.length ||
      component.fields.some((f) => !validKey(f.key) || !['text', 'number', 'fields', 'scalar'].includes(f.type))
    )
      throw Error('Invalid or duplicate versioned flow component');
    this.components.set(component.type, component);
  }
  get(type: string): FlowComponent {
    const component = this.components.get(type);
    if (!component) throw Error('Unknown flow component: ' + type);
    return component;
  }
  dependencies(definition: FlowDefinition): Record<string, string> {
    return Object.fromEntries(
      [...new Set(definition.nodes.map((n) => n.type))]
        .sort()
        .map((type) => [type, this.get(type).implementationRevision ?? type])
    );
  }
  catalog(): FlowNodeDescriptor[] {
    return [...this.components.values()].map(({ type, label, group, fields, ports }) => ({
      type,
      label,
      group,
      fields: fields.map((f) => ({ ...f })),
      ports: [...ports],
    }));
  }
}
export const defaultFlowRegistry = new FlowRegistry();
export const flowCatalog = defaultFlowRegistry.catalog();

export function checkFlowConfig(component: FlowComponent, value: unknown): asserts value is Record<string, unknown> {
  if (
    !record(value) ||
    !exact(
      value,
      component.fields.map((f) => f.key)
    )
  )
    throw Error('Invalid fields for ' + component.label);
  for (const field of component.fields) {
    const v = value[field.key];
    const valid =
      field.type === 'number'
        ? typeof v === 'number' && Number.isFinite(v) && v >= (field.min ?? -Infinity) && v <= (field.max ?? Infinity)
        : field.type === 'fields'
          ? Array.isArray(v) && v.length > 0 && v.length <= 32 && v.every(validKey) && new Set(v).size === v.length
          : field.type === 'scalar'
            ? scalar(v)
            : typeof v === 'string' && !!v.trim() && v.length <= 2048 && !v.includes('\0');
    if (!valid) throw Error('Invalid ' + field.label + ' for ' + component.label);
  }
  component.validate?.(value);
}

export function validateFlow(value: unknown, registry = defaultFlowRegistry): asserts value is FlowDefinition {
  if (
    !record(value) ||
    !exact(value, ['version', 'name', 'nodes', 'edges']) ||
    value['version'] !== 1 ||
    typeof value['name'] !== 'string' ||
    !value['name'].trim() ||
    value['name'].length > 120 ||
    !Array.isArray(value['nodes']) ||
    !value['nodes'].length ||
    value['nodes'].length > 64 ||
    !Array.isArray(value['edges']) ||
    value['edges'].length > 128
  )
    throw Error('Invalid flow definition');
  const nodes = new Map<string, FlowComponent>();
  for (const node of value['nodes']) {
    if (
      !record(node) ||
      !exact(node, ['id', 'type', 'config']) ||
      !validKey(node['id']) ||
      typeof node['type'] !== 'string' ||
      nodes.has(node['id'])
    )
      throw Error('Invalid or duplicate node identity');
    const component = registry.get(node['type']);
    checkFlowConfig(component, node['config']);
    nodes.set(node['id'], component);
  }
  const incoming = new Set<string>();
  const children = new Map<string, string[]>();
  for (const edge of value['edges']) {
    if (
      !record(edge) ||
      !exact(edge, ['from', 'port', 'to']) ||
      !validKey(edge['from']) ||
      !validKey(edge['port']) ||
      !validKey(edge['to']) ||
      !nodes.get(edge['from'])?.ports.includes(edge['port']) ||
      !nodes.has(edge['to']) ||
      nodes.get(edge['to'])!.group === 'source' ||
      incoming.has(edge['to'])
    )
      throw Error('Connect a declared output to one unoccupied input');
    incoming.add(edge['to']);
    const outgoing = children.get(edge['from']) ?? [];
    outgoing.push(edge['to']);
    children.set(edge['from'], outgoing);
  }
  const reachable = [...nodes].filter(([, c]) => c.group === 'source').map(([id]) => id);
  if (!reachable.length) throw Error('Add an event source');
  for (let i = 0; i < reachable.length; i++) reachable.push(...(children.get(reachable[i]!) ?? []));
  if (reachable.length !== nodes.size) throw Error('Every node needs a path from a source. Cycles are unavailable.');
  if (![...nodes.values()].some((c) => c.group === 'output')) throw Error('Add an output for the flow');
}

/** Compile the graph once for a reviewed revision; later samples reuse its adjacency index. */
export function compileFlow(input: FlowDefinition, registry = defaultFlowRegistry) {
  validateFlow(input, registry);
  const definition = structuredClone(input);
  const byId = new Map(definition.nodes.map((n) => [n.id, n]));
  const outputs = new Map<string, Map<string, FlowDefinition['edges']>>();
  for (const edge of definition.edges) {
    const ports = outputs.get(edge.from) ?? new Map<string, FlowDefinition['edges']>();
    const list = ports.get(edge.port) ?? [];
    list.push(edge);
    ports.set(edge.port, list);
    outputs.set(edge.from, ports);
  }
  return (event: FlowEvent, state: FlowState = {}): FlowPreview => {
    if (
      !record(event) ||
      !exact(event, ['id', 'source', 'type', 'data']) ||
      typeof event.id !== 'string' ||
      !event.id.trim() ||
      event.id.length > 160 ||
      !validKey(event.source) ||
      typeof event.type !== 'string' ||
      event.type.length > 160
    )
      throw Error('Invalid flow event identity');
    dataFields(event.data);
    const first = byId.get(event.source);
    if (!first || !registry.get(first.type).accepts?.(first.config, event.type))
      throw Error('Event does not match this source');
    if (
      first.type === 'host.disk@1' &&
      (!Number.isSafeInteger(event.data['freeBytes']) ||
        !Number.isSafeInteger(event.data['totalBytes']) ||
        Number(event.data['freeBytes']) < 0 ||
        Number(event.data['freeBytes']) > Number(event.data['totalBytes']))
    )
      throw Error('Invalid disk observation');
    if (
      !record(state) ||
      Object.keys(state).length > 64 ||
      Object.entries(state).some(([name, value]) => !byId.has(name) || typeof value !== 'boolean')
    )
      throw Error('Invalid state for this flow revision');
    const result: FlowPreview = { state: { ...state }, visited: [], traversed: [], effects: [] };
    const queue = [{ node: first, data: event.data }];
    for (let index = 0; index < queue.length; index++) {
      const { node, data } = queue[index]!;
      const component = registry.get(node.type);
      const decision = component.evaluate(
        node.config,
        { ...data },
        Object.hasOwn(result.state, node.id) ? result.state[node.id] : undefined
      );
      result.visited.push(node.id);
      if (decision.state !== undefined) result.state[node.id] = decision.state;
      if (decision.effect)
        result.effects.push({ nodeId: node.id, kind: decision.effect, config: { ...node.config }, data: { ...data } });
      for (const delivery of decision.deliveries ?? []) {
        if (!component.ports.includes(delivery.port)) throw Error('Component emitted an undeclared output');
        dataFields(delivery.data);
        for (const edge of outputs.get(node.id)?.get(delivery.port) ?? []) {
          if (queue.length >= 256) throw Error('Event exceeds the flow delivery limit');
          result.traversed.push({ ...edge });
          queue.push({ node: byId.get(edge.to)!, data: delivery.data });
        }
      }
    }
    return result;
  };
}

export function evaluateFlow(
  definition: FlowDefinition,
  event: FlowEvent,
  state: FlowState = {},
  registry = defaultFlowRegistry
): FlowPreview {
  return compileFlow(definition, registry)(event, state);
}

export function diskSpaceFlow(path: string, below: number, rearmAt: number, intervalMs = 60000): FlowDefinition {
  return {
    version: 1,
    name: 'Disk space',
    nodes: [
      { id: 'disk', type: 'host.disk@1', config: { path, intervalMs } },
      { id: 'threshold', type: 'logic.threshold@1', config: { field: 'freeBytes', below, rearmAt } },
      { id: 'low', type: 'output.notify@1', config: { title: 'Disk space is low' } },
      { id: 'restored', type: 'output.notify@1', config: { title: 'Disk space recovered' } },
    ],
    edges: [
      { from: 'disk', port: 'event', to: 'threshold' },
      { from: 'threshold', port: 'low', to: 'low' },
      { from: 'threshold', port: 'recovered', to: 'restored' },
    ],
  };
}
