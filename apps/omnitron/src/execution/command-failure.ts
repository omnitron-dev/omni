/**
 * Read a failed command's diagnostic, never its stdout (which can be private
 * machine data). Also embedded in the remote supervisor probe, before its
 * child process's stderr is wrapped in another error.
 */
export function commandFailure(stderr: string, fallback: string): string {
  let lines = stderr.trim().split(/\r?\n/);
  // Omnitron --json writes its failure to stderr. A Node warning may precede it.
  for (const line of lines) {
    if (!line.startsWith('{')) continue;
    try {
      const response = JSON.parse(line);
      if (response?.ok === false && typeof response.error === 'string' && response.error.trim()) {
        lines = response.error.trim().split(/[\r\n]+/);
        break;
      }
    } catch { /* Other tools can write non-JSON stderr. */ }
  }
  // Uncaught Node errors start with a source location, source and a caret.
  // Only an error header at the start of a line is a diagnostic.
  const header = lines.find(line =>
    /^(?:Error|[A-Z]\w*Error)(?: \[[\w-]+\])?:\s*\S/.test(line) && !line.startsWith('Error: Command failed:'));
  const first = header?.replace(/^Error:\s*/, '') ?? lines[0]?.trim();
  if (!first || /^(?:file:\/\/|\[eval\b|node:|at\s|Node\.js v|(?:Error: )?Command failed:)/.test(first)) return fallback;
  return first;
}
