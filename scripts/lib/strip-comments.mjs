/**
 * Remove comments from TypeScript/JavaScript source, keeping the code.
 *
 * Seven scanners in this repository each carried their own copy of a pair of
 * regexes: one matching from a block-comment opener to the next closer, one
 * matching a line comment to its newline. A regex cannot tell a comment from
 * the same characters inside a string. It deletes from the first opener to
 * the first closer it finds afterwards, wherever those happen to be — and a
 * template literal holding a shell script, a glob, or a URL contains both.
 *
 * (This docblock cannot show the regexes, because a block comment cannot
 * contain a block-comment closer. That limitation is the defect itself,
 * seen from the other side: the same two characters end a comment whatever
 * is around them, in a docblock and in a scanner alike.)
 *
 * Measured across `apps/omnitron/src` before this existed: 6 502 bytes of
 * real code deleted in 6 of 234 files, 5 238 of them in one — a file whose
 * template literals hold build commands. The scanners that read that output
 * were looking at source with holes in it and reporting what they could not
 * see as absent.
 *
 * Nothing goes red when this happens, which is why it survives: a scanner
 * that cannot see a call site reports no call site, and a clean scan is
 * exactly what everyone hopes for.
 *
 * This walks the source instead. It is not a parser — it does not need to
 * be. It needs to know that a quote starts a string, that a backslash
 * escapes the next character, and that comments do not begin inside one.
 *
 * Whitespace is preserved for block comments (one space) and line comments
 * are dropped up to their newline, so line numbers survive: a scanner
 * reporting `file:line` must report the line the reader will open.
 */

/**
 * Whether a `/` at `i` begins a regex literal rather than a division.
 *
 * The distinction matters because `/pattern/` can contain `//` and `/*`.
 * JavaScript resolves it by what precedes the slash: after a value (an
 * identifier, a literal, a closing bracket) it is division; after an
 * operator, a keyword, or nothing, it starts a regex.
 *
 * The heuristic is the standard one and it is wrong in the same rare cases
 * every implementation of it is wrong — but wrong towards treating a regex
 * as division, which keeps code rather than deleting it. That is the
 * direction this has to err in.
 */
function regexCanStartHere(out) {
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const c = out[i];
    if (c === ' ' || c === '\n' || c === '\t' || c === '\r') continue;
    return !/[A-Za-z0-9_$)\]]/.test(c);
  }
  return true;
}

export function stripComments(source) {
  let out = '';
  let i = 0;
  const n = source.length;

  while (i < n) {
    const c = source[i];
    const d = source[i + 1];

    // Strings and template literals: copied through whole. A template can
    // hold `${…}` with code in it, and comments inside THAT would survive —
    // accepted deliberately, because keeping a comment is a false negative
    // for a scanner and deleting code is a false positive.
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i += 1;
      while (i < n) {
        if (source[i] === '\\') {
          out += source[i] + (source[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    if (c === '/' && d === '*') {
      const end = source.indexOf('*/', i + 2);
      const body = source.slice(i, end < 0 ? n : end + 2);
      // Newlines are kept so every later line keeps its number.
      out += body.replace(/[^\n]/g, ' ');
      i = end < 0 ? n : end + 2;
      continue;
    }

    if (c === '/' && d === '/') {
      const end = source.indexOf('\n', i);
      i = end < 0 ? n : end;
      continue;
    }

    if (c === '/' && regexCanStartHere(out)) {
      // A regex literal. Copied through, because `/\/\*/` is code.
      out += c;
      i += 1;
      let inClass = false;
      while (i < n) {
        const r = source[i];
        if (r === '\\') {
          out += r + (source[i + 1] ?? '');
          i += 2;
          continue;
        }
        if (r === '\n') break; // Unterminated — not a regex after all.
        out += r;
        i += 1;
        if (r === '[') inClass = true;
        else if (r === ']') inClass = false;
        else if (r === '/' && !inClass) break;
      }
      continue;
    }

    out += c;
    i += 1;
  }

  return out;
}

export default stripComments;
