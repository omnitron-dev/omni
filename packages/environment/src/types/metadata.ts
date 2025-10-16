import { EnvironmentId } from './common.js';

/**
 * Environment metadata
 */
export interface EnvironmentMetadata {
  // Classification
  scope: 'global' | 'user' | 'workspace' | 'profile' | 'context';
  profile?: string;
  stage?: 'development' | 'staging' | 'production' | 'test';

  // Documentation
  description?: string;
  tags: string[];
  labels: Record<string, string>;
  annotations: Record<string, string>;

  // Relationships
  extends?: EnvironmentId[];
  overrides?: EnvironmentId;
  includes?: EnvironmentId[];

  // Origin
  source: 'file' | 'database' | 'api' | 'memory';
  sourcePath?: string;
  repository?: string;
  commit?: string;

  // Permissions
  owner: string;
  permissions?: PermissionSet;

  // Lifecycle
  ttl?: number;
  expiresAt?: Date;
  isEphemeral: boolean;

  // Tracking
  changeCount: number;
  checksum: string;
}

/**
 * Permission set for access control
 */
export interface PermissionSet {
  read: string[];
  write: string[];
  delete: string[];
  admin: string[];
}

/**
 * Default metadata factory
 */
export function createDefaultMetadata(overrides?: Partial<EnvironmentMetadata>): EnvironmentMetadata {
  return {
    scope: 'workspace',
    tags: [],
    labels: {},
    annotations: {},
    source: 'memory',
    owner: 'system',
    isEphemeral: false,
    changeCount: 0,
    checksum: '',
    ...overrides,
  };
}
