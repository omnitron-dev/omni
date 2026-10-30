import { migration } from './migrations/014_replication_receipts.js';

/**
 * Reviewed backward-compatible expansions, not an inference from a filename.
 * Destructive or locally reinterpreted migrations require a separate rollout.
 */
export const MASTER_SCHEMA_EXPANSIONS = [{
  name: migration.name,
  checksum: migration.checksum!,
  summary: 'Add a receipt outcome with an unverified default; existing writers and readers remain valid.',
}];
