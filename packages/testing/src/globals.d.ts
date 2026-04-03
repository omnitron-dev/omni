/**
 * Global type declarations for cross-runtime testing
 */

declare global {
  // Bun global
  const Bun: any;

  // Deno global
  const Deno: any;

  // Vitest globals (for Node.js)
  const vi: any;
  const describe: any;
  const it: any;
  const test: any;
  const expect: any;
  const beforeEach: any;
  const afterEach: any;
  const beforeAll: any;
  const afterAll: any;
}

export {};
