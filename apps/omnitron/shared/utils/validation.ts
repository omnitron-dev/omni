/**
 * Validation Utilities
 *
 * Shared validation functions for data integrity
 */

import type { FlowDefinition, FlowNode } from '../types/flow.js';

/**
 * Validate Flow Definition
 */
export function validateFlowDefinition(flow: FlowDefinition): ValidationResult {
  const errors: string[] = [];

  if (!flow.id || typeof flow.id !== 'string') {
    errors.push('Flow must have a valid ID');
  }

  if (!flow.metadata?.name) {
    errors.push('Flow must have a name');
  }

  if (!Array.isArray(flow.nodes)) {
    errors.push('Flow must have nodes array');
  }

  if (!Array.isArray(flow.connections)) {
    errors.push('Flow must have connections array');
  }

  // Validate nodes
  for (const node of flow.nodes || []) {
    const nodeErrors = validateFlowNode(node);
    errors.push(...nodeErrors.errors);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate Flow Node
 */
export function validateFlowNode(node: FlowNode): ValidationResult {
  const errors: string[] = [];

  if (!node.id) {
    errors.push('Node must have an ID');
  }

  if (!node.type) {
    errors.push('Node must have a type');
  }

  if (!node.position || typeof node.position.x !== 'number' || typeof node.position.y !== 'number') {
    errors.push('Node must have valid position');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
