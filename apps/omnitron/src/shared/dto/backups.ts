/**
 * Backup DTOs — wire shapes shared with the Omnitron Console.
 *
 * Declared away from the service implementation for the reason set out in
 * `./auth.ts`: a DTO that imports from an implementation drags decorators and
 * the server's dependency graph into the console's build.
 */

export interface BackupInfo {
  id: string;
  database: string;
  filename: string;
  size: number;
  createdAt: string;
  compressed: boolean;
}

