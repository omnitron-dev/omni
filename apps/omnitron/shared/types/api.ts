/**
 * API Contract Definitions
 *
 * Shared API contracts between backend (Titan/Netron) and frontend (Aether)
 */

import type { FlowDefinition, ExecutionResult } from './flow.js';

/**
 * Flow Service Contract
 *
 * RPC interface for Flow execution and management
 */
export interface FlowServiceContract {
  executeFlow(flowId: string, input: any): Promise<ExecutionResult>;
  saveFlow(flow: FlowDefinition): Promise<string>;
  loadFlow(flowId: string): Promise<FlowDefinition>;
  listFlows(): Promise<FlowSummary[]>;
  deleteFlow(flowId: string): Promise<void>;
}

export interface FlowSummary {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  created: Date;
  modified: Date;
  tags: string[];
}

/**
 * Workspace Service Contract
 */
export interface WorkspaceServiceContract {
  createWorkspace(name: string, config?: WorkspaceConfig): Promise<string>;
  loadWorkspace(id: string): Promise<Workspace>;
  saveWorkspace(workspace: Workspace): Promise<void>;
  deleteWorkspace(id: string): Promise<void>;
}

export interface Workspace {
  id: string;
  name: string;
  flows: string[];
  configuration: Record<string, any>;
  created: Date;
  modified: Date;
}

export interface WorkspaceConfig {
  theme?: string;
  layout?: string;
  preferences?: Record<string, any>;
}

/**
 * Intelligence Service Contract
 */
export interface IntelligenceServiceContract {
  generateCode(prompt: string, context?: any): Promise<string>;
  optimizeFlow(flow: FlowDefinition): Promise<FlowDefinition>;
  chat(message: string, context?: any): Promise<string>;
  streamChat(message: string, context?: any): AsyncIterableIterator<string>;
}
