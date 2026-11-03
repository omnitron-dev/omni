/** Reader-safe evidence from current and legacy owner errors. Never expose arbitrary stderr. */
export function publicLaunchFailure(error: unknown): string {
  const seen = new Set<object>();
  for (let depth = 0; depth < 4 && error && typeof error === 'object' && !seen.has(error); depth++) {
    seen.add(error);
    const candidate = error as { message?: unknown; cause?: unknown };
    const message = typeof candidate.message === 'string' ? candidate.message.slice(0, 16_384) : '';
    const process = message.match(/\bexited during startup (?:with code -?\d{1,10}|: killed by SIG[A-Z0-9]{1,16})\b|\bdid not confirm readiness within \d{1,10}ms\b/);
    if (process) return process[0];

    const missing = message.match(/\bCannot find (module|package) ['"]([^'"\r\n]{1,1024})['"]/);
    if (missing) {
      const target = missing[2]!;
      // Only a package identifier or a source filename, never its directory,
      // URL parameters, control characters, or arbitrary exception context.
      const packageName = /^(?:@[a-z0-9][a-z0-9._-]{0,63}\/)?[a-z0-9][a-z0-9._-]{0,95}$/;
      const basename = target.split(/[/\\]/).at(-1) ?? '';
      const filename = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}\.(?:[cm]?[jt]sx?|json|node|wasm)$/;
      const hasControls = Array.from(target).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
      const safePath = !hasControls && !/[?#]/.test(target) && (!target.includes('://') || target.startsWith('file:///'));
      if (missing[1] === 'module' && safePath && filename.test(basename)) {
        return `module "${basename}" is unavailable; verify dependency installation and the active runtime compiler`;
      }
      if (packageName.test(target)) return `package "${target}" is unavailable; install the declared dependencies`;
      return 'a required module is unavailable; verify dependency installation and the active runtime compiler';
    }
    error = candidate.cause;
  }
  return 'launch failed (see daemon log)';
}
