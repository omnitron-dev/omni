/**
 * What happens to a console crash.
 *
 * The console's own error boundary had no `componentDidCatch`, so a crash
 * produced a sentence on screen and nothing anywhere else: no stack, no
 * component trace, nothing for the operator to attach to a report. For the
 * window an operator watches a platform through, "something went wrong" with
 * no way to say what is the least useful outcome available.
 *
 * The boundary's own panel shows the parsed location and the raw stack —
 * `showDetails` is passed explicitly rather than left to the dev-mode
 * default, because an operator hitting this in a production build is exactly
 * who needs the stack. This adds the other half: the same information in the
 * browser console, where a devtools session already open will have captured
 * it, and where it survives the operator clicking "Try Again".
 */

import type { ErrorInfo } from 'react';

interface ParsedStack {
  primary?: { filePath: string | null; lineNumber: number | null; functionName: string | null } | null;
  raw?: string;
}

export function reportCrash(error: Error, errorInfo: ErrorInfo, parsedStack: ParsedStack): void {
  const where = parsedStack.primary;
  const location = where
    ? `${where.filePath ?? 'unknown'}:${where.lineNumber ?? '?'}${where.functionName ? ` (${where.functionName})` : ''}`
    : 'unknown location';

  // `console.error` rather than a logger: this runs when React has already
  // decided the tree cannot render, so anything with its own machinery is a
  // second thing that can fail at the worst moment.
  console.error(`[omnitron-console] crashed at ${location}: ${error.message}`, {
    error,
    componentStack: errorInfo.componentStack,
  });
}
