/**
 * Canvas Module - Barrel Exports
 *
 * Centralized exports for the Canvas module
 */

// Module definition
export { CanvasModule } from './canvas.module';

// Services
export { FlowService } from './services/flow.service';
export { CanvasService } from './services/canvas.service';
export type { CanvasTransform, CanvasSelection } from './services/canvas.service';

// Stores
export { useCanvasStore } from './stores/canvas.store';
export type { CanvasState } from './stores/canvas.store';

// Components
export { FlowCanvas } from './components/FlowCanvas';
export { FlowNode } from './components/FlowNode';
export { FlowConnection } from './components/FlowConnection';
export { NodeProperties } from './components/NodeProperties';

// Re-export types from shared
export type {
  FlowDefinition,
  FlowNode as FlowNodeType,
  FlowConnection as FlowConnectionType,
  FlowMetadata,
  Port,
  ExecutionResult,
  ExecutionStatus,
} from '../../../../../../shared/types/flow';
