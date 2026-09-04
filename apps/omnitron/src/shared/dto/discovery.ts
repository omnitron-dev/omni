/**
 * Discovery DTOs — wire shapes shared with the Omnitron Console.
 *
 * Declared away from the service implementation for the reason set out in
 * `./auth.ts`: a DTO that imports from an implementation drags decorators and
 * the server's dependency graph into the console's build.
 */

export interface OmnitronDiscoveredTarget {
  id: string;
  type: 'docker' | 'ssh' | 'unknown';
  name: string;
  address: string;
  port: number;
  status: string;
  labels?: Record<string, string> | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface DiscoveryScanResult {
  docker: OmnitronDiscoveredTarget[];
  ssh: OmnitronDiscoveredTarget[];
  timestamp: string;
  duration: number;
}
