/**
 * Flow Type Definitions
 *
 * Shared types for Flow system used across backend and frontend
 */

export interface FlowMetadata {
  name: string;
  version: string;
  description: string;
  author: string;
  created: Date;
  modified: Date;
  tags: string[];
  documentation?: string;
}

export interface FlowDefinition {
  id: string;
  metadata: FlowMetadata;
  nodes: FlowNode[];
  connections: FlowConnection[];
  configuration?: Record<string, any>;
}

export interface FlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, any>;
  inputs: Port[];
  outputs: Port[];
}

export interface Port {
  id: string;
  name: string;
  type: string;
  required?: boolean;
}

export interface FlowConnection {
  id: string;
  from: { nodeId: string; portId: string };
  to: { nodeId: string; portId: string };
}

export interface ExecutionResult {
  id: string;
  flowId: string;
  status: 'success' | 'error' | 'cancelled';
  output?: any;
  error?: string;
  duration: number;
  timestamp: Date;
}

export type ExecutionStatus = 'pending' | 'running' | 'success' | 'error' | 'cancelled';
