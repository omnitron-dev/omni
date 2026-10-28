/** POSIX shell arguments are data, including quotes, substitutions and newlines. */
export function quoteShellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
