import type { IStackInfo } from '../shared/dto/project.js';

/** Read models expose placement, never SSH keys, environment values or service credentials. */
export function publicStack(info: IStackInfo): IStackInfo {
  const config = info.config;
  return {
    ...info,
    config: {
      type: config.type,
      ...(config.release ? { release: { mode: config.release.mode } } : {}),
      ...(config.watch !== undefined ? { watch: config.watch } : {}),
      ...(config.apps ? { apps: config.apps } : {}),
      ...(config.portRange ? { portRange: config.portRange } : {}),
      ...(config.nodes
        ? {
            nodes: config.nodes.map((node) => ({
              host: node.host,
              port: node.port ?? 9700,
              role: node.role,
              ...(node.label ? { label: node.label } : {}),
              ...(node.apps ? { apps: node.apps } : {}),
            })),
          }
        : {}),
    },
  };
}
