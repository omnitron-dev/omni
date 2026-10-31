import { createHash } from 'node:crypto';
import type { IEcosystemAppEntry, IStackConfig } from '../config/types.js';
import type { TopologySpec, TopologyChange, TopologyIssue } from '../shared/dto/topology.js';
import { nodeApplicationNames, resolveNodePlacements, stackNodeKey } from './stack-placement.js';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)])
    );
  return value;
}
export const topologyRevision = (value: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');

export function topologySpec(config: IStackConfig, apps: readonly IEcosystemAppEntry[]): TopologySpec {
  const names = apps.map((app) => app.name);
  return {
    version: 1,
    type: config.type,
    apps: names,
    nodes: (config.nodes ?? []).map((node) => ({
      host: node.host,
      port: node.port ?? 9700,
      role: node.role,
      ...(node.label ? { label: node.label } : {}),
      apps: [...nodeApplicationNames(config, node, names)],
    })),
  };
}

/** Closed input schema: unknown fields cannot smuggle credentials or execution options through the editor. */
export function validateTopologySpec(input: unknown): TopologySpec {
  const object = <K extends string>(value: unknown, keys: K[], where: string): Record<K, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${where} must be an object`);
    if (Object.keys(value).some((key) => !keys.includes(key as K))) throw new Error(`Unknown field in ${where}`);
    return value as Record<K, unknown>;
  };
  const names = (value: unknown, where: string): string[] => {
    if (
      !Array.isArray(value) ||
      value.length > 500 ||
      value.some((name) => typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name))
    )
      throw new Error(`${where} must contain valid application names`);
    if (new Set(value).size !== value.length) throw new Error(`${where} contains duplicate applications`);
    return [...value];
  };
  const spec = object(input, ['version', 'type', 'apps', 'nodes'], 'topology');
  if (spec.version !== 1 || !['local', 'remote', 'cluster'].includes(String(spec.type)))
    throw new Error('Unsupported topology version or type');
  if (!Array.isArray(spec.nodes) || spec.nodes.length > 64)
    throw new Error('Topology supports up to 64 explicitly placed nodes');
  const nodes = spec.nodes.map((value, index) => {
    const node = object(value, ['host', 'port', 'role', 'label', 'apps'], `node ${index + 1}`);
    if (typeof node.host !== 'string' || !node.host || node.host.length > 253 || /[\s/\\\0]/.test(node.host))
      throw new Error('Invalid node host');
    if (!Number.isInteger(node.port) || Number(node.port) < 1 || Number(node.port) > 65535)
      throw new Error('Invalid daemon port');
    if (!['app', 'database', 'cache', 'gateway', 'worker', 'master'].includes(String(node.role)))
      throw new Error('Invalid node role');
    if (
      node.label !== undefined &&
      (typeof node.label !== 'string' || node.label.length > 160 || /[\r\n\0]/.test(node.label))
    )
      throw new Error('Invalid node label');
    return {
      host: node.host,
      port: Number(node.port),
      role: node.role as TopologySpec['nodes'][number]['role'],
      ...(node.label ? { label: node.label as string } : {}),
      apps: names(node.apps, 'Node applications'),
    };
  });
  if (spec.type === 'local' && nodes.length) throw new Error('Local topology cannot declare remote nodes');
  if (spec.type === 'remote' && nodes.length !== 1)
    throw new Error('Remote topology requires one node; use cluster for multiple nodes');
  if (spec.type === 'cluster' && !nodes.length) throw new Error('Cluster topology requires at least one node');
  return { version: 1, type: spec.type as TopologySpec['type'], apps: names(spec.apps, 'Stack applications'), nodes };
}

/** Reuse deployment configuration and preserve SSH references outside the portable document. */
export function applyTopologySpec(base: IStackConfig, spec: TopologySpec): IStackConfig {
  return {
    ...base,
    type: spec.type,
    apps: [...spec.apps],
    nodes: spec.nodes.map((node) => {
      const original = base.nodes?.find(
        (old) => stackNodeKey(old.host, old.port) === stackNodeKey(node.host, node.port)
      );
      return { ...original, ...node, apps: [...node.apps] };
    }),
  };
}

export function topologyChanges(before: TopologySpec, after: TopologySpec): TopologyChange[] {
  const resources = (spec: TopologySpec) => {
    const result = new Map<string, Omit<TopologyChange, 'action'>>();
    if (spec.type === 'local')
      for (const app of spec.apps)
        result.set(`application:local/${app}`, { resource: 'application', name: app, node: 'local' });
    for (const node of spec.nodes) {
      const key = stackNodeKey(node.host, node.port);
      result.set(`node:${key}`, { resource: 'node', name: node.label ?? node.host, node: key });
      for (const app of node.apps)
        result.set(`application:${key}/${app}`, { resource: 'application', name: app, node: key });
    }
    return result;
  };
  const previous = resources(before),
    next = resources(after);
  const priorNodes = new Map(before.nodes.map((node) => [stackNodeKey(node.host, node.port), node]));
  const updates: TopologyChange[] = [];
  for (const node of after.nodes) {
    const key = stackNodeKey(node.host, node.port);
    const prior = priorNodes.get(key);
    if (!prior) continue;
    const fields = (['role', 'label'] as const).flatMap((field) =>
      (prior[field] ?? null) === (node[field] ?? null)
        ? []
        : [{ field, before: prior[field] ?? null, after: node[field] ?? null }]
    );
    if (fields.length)
      updates.push({ action: 'update', resource: 'node', name: node.label ?? node.host, node: key, fields });
  }
  return [
    ...[...previous].filter(([id]) => !next.has(id)).map(([, value]) => ({ ...value, action: 'remove' as const })),
    ...[...next].filter(([id]) => !previous.has(id)).map(([, value]) => ({ ...value, action: 'add' as const })),
    ...updates,
  ];
}

export function topologyIssues(spec: TopologySpec, apps: readonly IEcosystemAppEntry[]): TopologyIssue[] {
  const issues: TopologyIssue[] = [];
  const entries = apps.filter((app) => spec.apps.includes(app.name));
  const unknown = spec.apps.filter((name) => !entries.some((app) => app.name === name));
  if (unknown.length)
    issues.push({
      severity: 'error',
      code: 'unknown-application',
      message: `Applications are not enabled in this project: ${unknown.join(', ')}`,
    });
  try {
    resolveNodePlacements(applyTopologySpec({ type: spec.type }, spec), entries);
  } catch (error) {
    issues.push({ severity: 'error', code: 'invalid-placement', message: (error as Error).message });
  }
  return issues;
}
