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

/**
 * How one pass ended. `empty` is its own word: a pass that found nothing to
 * back up did not succeed, and must not read as if it had.
 */
export type BackupPassOutcome = 'ok' | 'partial' | 'failed' | 'empty';

/** One entry of a pass: a database, or a `full`-only artefact. */
export interface BackupPassEntry {
  target: string;
  ok: boolean;
  id?: string;
  size?: number;
  error?: string;
  /**
   * A running stack this pass could not reach at all — its databases are not
   * on this host. Reported with the pass, and left out of its outcome: it is
   * a gap in what the master can do, not a dump that failed.
   */
  skipped?: boolean;
}

/**
 * Where a backup came from. The index row used to hold id, database,
 * filename, size, createdAt, compressed — no stack — so a listing could not
 * say whose `main` a row was, and a restore went to whichever stack happened
 * to be first.
 */
export type BackupOrigin = { project: string; stack: string } | 'control-plane';

/** A backup as listed: the wire DTO, plus where it came from. */
export interface BackupRecord extends BackupInfo {
  /** The project and stack a stack database belongs to. Absent on rows written before it was recorded. */
  project?: string;
  stack?: string;
  /** `control-plane` for the daemon's own state (`omnitron`, `daemon-state`). */
  scope?: 'stack' | 'control-plane';
}

/** A running stack, and whether `all` can reach its databases from this host. */
export interface BackupStackCoverage {
  project: string;
  stack: string;
  /** The databases `all` dumps for it; empty when it has none this host can reach. */
  databases: string[];
  /** Why its databases are not backed up from here; absent when they are. */
  notBackedUp?: string;
}

/** What the last pass of one target did — persisted, so it outlives a restart. */
export interface BackupPassRecord {
  target: string;
  trigger: 'schedule' | 'manual';
  startedAt: string;
  finishedAt: string;
  outcome: BackupPassOutcome;
  ok: number;
  total: number;
  failures: Array<{ target: string; error: string }>;
  /** Running stacks the pass could not reach, and why. */
  notBackedUp?: Array<{ stack: string; reason: string }>;
}

/** A configured schedule, and what it last did. */
export interface BackupScheduleStatus {
  target: string;
  /** The specification as stored — cron, preset, or ms. */
  spec: string;
  /** `describeSchedule` of it, or null when the stored spec cannot be read. */
  schedule: string | null;
  /** Why the stored spec cannot be read: configured, and not running. */
  error?: string;
  armed: boolean;
  /** The last pass this target ran, from any daemon run; null if none was recorded. */
  lastPass: BackupPassRecord | null;
  /** The target's newest backup in the index — what its next run is measured from. */
  lastBackupAt: string | null;
  /** When the armed timer fires, or null when the schedule is not armed. */
  nextRunAt: string | null;
}

/** Everything `backup schedules` and `backup list` need beyond the index rows. */
export interface BackupStatus {
  schedules: BackupScheduleStatus[];
  /** Every running stack, and whether this host backs its databases up. */
  stacks: BackupStackCoverage[];
}
