import type { FlowDefinition, FlowEffect, FlowEvent, FlowNodeDescriptor, FlowPreview, FlowState } from './flows.js';

export interface FlowWorkspace {
  project: string | null;
  stack?: string;
}
export interface FlowRef {
  workspace: FlowWorkspace;
  id: string;
}
export interface FlowActivation {
  id: string;
  revision: string;
  definition: FlowDefinition;
  actor: string;
  startedAt: number;
}
export interface SavedFlow extends FlowRef {
  revision: string;
  definition: FlowDefinition;
  active: FlowActivation | null;
  updatedAt: number;
  sources: { nodeId: string; dueAt: number; error: string | null }[];
}
export interface FlowDelivery {
  id: string;
  nodeId: string;
  kind: FlowEffect['kind'];
  title: string;
  status: 'delivered' | 'pending' | 'needs-review' | 'unconfirmed';
  result: string | null;
  error: string | null;
}
export interface FlowReceipt {
  event: FlowEvent;
  activation: string;
  revision: string;
  at: number;
  visited: string[];
  traversed: FlowDefinition['edges'];
  state: FlowState;
  deliveries: FlowDelivery[];
}
export interface FlowNotificationPage {
  cursor: number;
  items: { sequence: number; id: string; flowId: string; title: string; at: number }[];
}
export interface FlowSave extends FlowRef {
  definition: FlowDefinition;
  expectedRevision: string | null;
}
export interface FlowChange extends FlowRef {
  revision: string;
  activation: string | null;
}
export interface IOmnitronFlowsService {
  catalog(): Promise<{ nodes: FlowNodeDescriptor[]; diagnostics: readonly string[] }>;
  preview(data: { definition: FlowDefinition; event: FlowEvent; state?: FlowState }): Promise<FlowPreview>;
  list(data: { workspace: FlowWorkspace }): Promise<SavedFlow[]>;
  save(data: FlowSave): Promise<SavedFlow>;
  activate(data: FlowChange): Promise<SavedFlow>;
  deactivate(data: FlowChange): Promise<SavedFlow>;
  submit(data: FlowRef & { activation: string; event: FlowEvent }): Promise<FlowReceipt>;
  history(data: FlowRef & { limit?: number }): Promise<FlowReceipt[]>;
  notifications(data: { workspace: FlowWorkspace; after?: number; limit?: number }): Promise<FlowNotificationPage>;
  retryDelivery(data: FlowRef & { activation: string; delivery: string }): Promise<FlowDelivery>;
}
