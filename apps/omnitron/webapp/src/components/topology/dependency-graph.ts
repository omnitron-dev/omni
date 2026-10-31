import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { ProjectDependency } from '@omnitron-dev/omnitron/dto/services';
import type { TopologyNodeData, TopologyScope } from './topology-store';

/** Match deployment endpoints; loopback may refer to a shared service on this daemon. */
export function connectDependencies(
  nodes: Node<TopologyNodeData>[],
  edges: Edge[],
  dependencies: ProjectDependency[],
  scope: TopologyScope
): void {
  for (const dependency of dependencies) {
    const { project, stack, app, targetApp, host, port, service, via, evidence } = dependency;
    const band = scope.project ? stack : `${project}/${stack}`;
    const source = nodes.find(
      (node) =>
        node.type === 'appNode' &&
        node.id.startsWith(`app-${band}-`) &&
        (node.data.name === `${project}/${stack}/${app}` || String(node.data.name).split('/').at(-1) === app)
    );
    if (!source) continue;
    let target: Node<TopologyNodeData> | undefined;
    if (targetApp)
      target = nodes.find(
        (node) =>
          node.type === 'appNode' &&
          node.id.startsWith(`app-${band}-`) &&
          (node.data.name === targetApp || String(node.data.name).split('/').at(-1) === targetApp)
      );
    else if (host && port && service) {
      const names = service === 'storage' ? ['minio', 'storage', 's3'] : [service];
      const loopback = /^(localhost|127\.\d+\.\d+\.\d+|::1)$/.test(host);
      const onStack =
        loopback ||
        nodes.some(
          (node) =>
            node.data.nodeType === 'server' &&
            node.data.stacks.includes(stack) &&
            node.data.address.slice(0, node.data.address.lastIndexOf(':')) === host
        );
      const matches = onStack
        ? nodes.filter(
            (node) =>
              node.data.nodeType === 'infra' &&
              (node.id.startsWith(`infra-${band}-`) ||
                (loopback && source.data.remote === false && Boolean(node.data.containerId))) &&
              names.includes(node.data.service) &&
              node.data.port === port
          )
        : [];
      if (matches.length === 1) target = matches[0];
      if (!target) {
        const id = `infra-${band}-endpoint-${encodeURIComponent(`${service}:${host}:${port}`)}`;
        target = nodes.find((node) => node.id === id);
        if (!target) {
          target = {
            id,
            type: 'infraNode',
            position: { x: 0, y: 0 },
            data: {
              nodeType: 'infra',
              label: `${service} · ${host}`,
              service,
              stack: source.data.stack as string | null,
              deploymentKey: band,
              port,
              host,
              health: 'unknown',
              status: 'configured',
            },
          };
          nodes.push(target);
        }
      }
    }
    if (!target || target.id === source.id) continue;
    const id = `dependency:${source.id}:${target.id}`;
    const existing = edges.find((edge) => edge.id === id);
    if (existing) {
      const keys = existing.data!.via as string[];
      if (!keys.includes(via)) keys.push(via);
    } else
      edges.push({
        id,
        source: source.id,
        target: target.id,
        type: 'smoothstep',
        animated: false,
        label: service ?? 'depends on',
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        data: {
          evidence,
          via: [via],
          endpoint: host && port ? `${host.includes(':') ? `[${host}]` : host}:${port}` : undefined,
        },
        style: { strokeDasharray: evidence === 'configuration' ? '5 3' : undefined, strokeWidth: 1.5 },
      });
  }
}
