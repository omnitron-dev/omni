/**
 * What a migrator printed, as lines worth a log.
 *
 * A data migration reports what it did on stdout — daos 194 names every role it
 * swept, 195 counts the measurement axes it found and made and names the
 * hand-made ones — and the runner prints how many it applied. Both places that
 * run an app's migrations discarded all of it: a local stack's
 * (`ProjectService.runStackMigrations`) logged «Migrations applied», a node's
 * (`RemoteDeployer.migrateNodeApps`) «Database migrations applied on the
 * node», and neither anything it had been told (2026-09-25: 195 on dev and on
 * daos/test). The one line cut short is the runner's enumeration of every
 * migration it found, 202 names on one line: its count is kept, the names are
 * not.
 */
export function migrationOutput(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '')
    .map((line) => line.replace(/^(Discovered \d+ migration\(s\)):.*$/, '$1'));
}
