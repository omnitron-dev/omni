/**
 * Ambient declarations for the host globals this package feature-detects.
 *
 * netron-react runs in the browser and deliberately does not depend on
 * @types/node — pulling that in would make every Node API look available to
 * code that will ship to a browser. TypeScript 7 stopped including visible
 * @types packages by default, which is what surfaced these as errors.
 *
 * `process.env.NODE_ENV` is declared rather than rewritten: bundlers
 * (Vite, webpack, Rollup) statically replace that exact expression to strip
 * development-only branches, and routing it through `globalThis` would defeat
 * the substitution and ship the dead code.
 */

declare const process: {
  env: Record<string, string | undefined>;
};

/** Node/legacy-IE only; every use site guards with `typeof setImmediate`. */
declare function setImmediate<TArgs extends unknown[]>(
  callback: (...args: TArgs) => void,
  ...args: TArgs
): unknown;
