import { EnvironmentId } from './common.js';

/**
 * Diff between two environments
 */
export interface EnvironmentDiff {
  added: Record<string, any>;
  modified: Record<string, { before: any; after: any }>;
  deleted: string[];
  metadata: {
    timestamp: Date;
    env1Id: EnvironmentId;
    env2Id: EnvironmentId;
  };
}

/**
 * JSON Patch operation (RFC 6902)
 */
export interface PatchOperation {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: any;
  from?: string;
}

/**
 * Merge strategy
 */
export interface MergeStrategy {
  strategy?: 'shallow' | 'deep';
  arrays?: 'concat' | 'replace';
  conflicts?: 'prefer-left' | 'prefer-right' | 'throw';
  resolver?: (key: string, left: any, right: any) => any;
}

/**
 * Default merge strategy
 */
export const DEFAULT_MERGE_STRATEGY: Required<Omit<MergeStrategy, 'resolver'>> = {
  strategy: 'deep',
  arrays: 'replace',
  conflicts: 'prefer-right'
};
