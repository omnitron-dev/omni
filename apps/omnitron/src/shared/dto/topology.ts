import type { IStackInfo, ProjectDependency, ProjectTopology } from './project.js';

/** Portable desired placement. Application definitions, credentials and service bindings remain in project config. */
export interface TopologySpec {
  version: 1;
  type: 'local' | 'remote' | 'cluster';
  apps: string[];
  nodes: Array<{
    nodeId?: string;
    host: string;
    port: number;
    role: 'app' | 'database' | 'cache' | 'gateway' | 'worker' | 'master';
    label?: string;
    apps: string[];
  }>;
}
export interface TopologyScope {
  project: string;
  stack: string;
}
export interface TopologyDraft {
  revision: number;
  baseRevision: string;
  spec: TopologySpec;
  updatedAt: string;
}
export interface TopologyChange {
  action: 'add' | 'remove' | 'update';
  resource: 'application' | 'node';
  name: string;
  node: string;
  fields?: Array<{ field: 'role' | 'label' | 'nodeId'; before: string | null; after: string | null }>;
}
export interface TopologyIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}
export interface TopologyPlan extends TopologyScope {
  id: string;
  baseRevision: string;
  draftRevision: number;
  createdAt: string;
  expiresAt: string;
  spec: TopologySpec;
  changes: TopologyChange[];
  issues: TopologyIssue[];
  /** Persisting a target does not admit it for deployment, auto-resume or restart. */
  effect: 'configuration';
  status: 'planned' | 'applied';
  appliedAt?: string;
}
export interface TopologyWorkspace extends TopologyScope {
  coverage?: ProjectTopology['coverage'];
  revision: string;
  /** Executable project configuration, independent of accepted target intent. */
  configured: TopologySpec;
  desired: TopologySpec;
  draft: TopologyDraft | null;
  plans: TopologyPlan[];
  applications: Array<{ name: string; runtime: 'process'; dependsOn: string[] }>;
  services: Array<{
    name: string;
    runtime: 'docker' | 'host' | 'external' | 'configured';
    stateful: boolean | 'unknown';
  }>;
  availableNodes: Array<{ id: string; name: string; host: string; port: number }>;
  observed: IStackInfo;
  dependencies: ProjectDependency[];
  warnings: string[];
}

export interface TopologyInventory {
  generatedAt: string;
  deployments: Array<{ project: string; stack: IStackInfo }>;
  errors: Array<{ project: string; stack?: string; reason: string }>;
}
