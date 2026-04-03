/**
 * Docker Test Utilities
 *
 * Utility functions for Docker-based testing
 */

import { execSync } from 'node:child_process';

/**
 * Check if Docker is available and running
 *
 * @returns true if Docker is available and running, false otherwise
 */
export function isDockerAvailable(): boolean {
  try {
    // Use 'pipe' instead of 'ignore' to avoid timeout issues on some systems
    execSync('docker info', { stdio: 'pipe', timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}
