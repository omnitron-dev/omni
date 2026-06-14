/**
 * Environment-neutral debug logger for the shared HTTP-core primitives.
 *
 * titan passes its `ILogger` (structurally compatible — its `debug(message)`
 * overload satisfies this), while netron-browser relies on the `debug` flag and
 * the console fallback. Kept dependency-free so the package works unchanged in
 * both Node and the browser.
 */
export interface HttpCoreLogger {
  debug(message: string, ...args: any[]): void;
}
