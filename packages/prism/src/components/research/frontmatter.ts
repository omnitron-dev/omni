/** Recognize a leading YAML envelope without interpreting tags, aliases or values.
 * Masking preserves every UTF-16 offset and line ending in subsequent source spans. */
export function splitFrontmatter(source: string) {
  const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(source);
  if (!opening) return { body: source, metadata: undefined };
  let offset = opening[0].length;
  while (offset < source.length) {
    const newline = source.indexOf('\n', offset);
    const end = newline < 0 ? source.length : newline + 1;
    if (/^(?:---|\.\.\.)[ \t]*(?:\r?\n)?$/.test(source.slice(offset, end))) {
      const raw = source.slice(0, end);
      return {
        body: raw.replace(/[^\r\n]/g, ' ') + source.slice(end),
        metadata: { format: 'yaml' as const, raw, start: 0, end },
      };
    }
    offset = end;
  }
  return { body: source, metadata: undefined };
}
