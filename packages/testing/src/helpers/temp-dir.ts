/**
 * Temporary Directory Management
 *
 * Utilities for creating and cleaning up temporary directories during tests
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Create a temporary directory for tests
 *
 * Creates a unique temporary directory with the specified prefix.
 * The directory is created in the system's temp directory.
 *
 * @param prefix - Prefix for the temporary directory name (default: 'test-')
 * @returns Absolute path to the created temporary directory
 *
 * @example
 * ```typescript
 * const tmpDir = createTempDir('my-test-');
 * // Returns: /tmp/my-test-abc123
 * ```
 */
export function createTempDir(prefix = 'test-'): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return tempDir;
}

/**
 * Clean up temporary directory
 *
 * Recursively removes a directory and all its contents.
 * Safe to call even if the directory doesn't exist.
 *
 * @param dir - Absolute path to the directory to remove
 *
 * @example
 * ```typescript
 * const tmpDir = createTempDir();
 * // ... use tmpDir ...
 * cleanupTempDir(tmpDir); // Clean up after test
 * ```
 */
export function cleanupTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
