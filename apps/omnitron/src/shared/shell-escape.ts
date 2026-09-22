/**
 * Quote a string as one single-quoted shell word.
 *
 * Remote commands are strings handed to a shell that runs as the SSH user —
 * root, by default — so anything interpolated into one goes through here.
 * One implementation: the deployer and the node lease both build commands.
 */
export function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
