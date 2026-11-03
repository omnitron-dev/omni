import path from 'node:path';
import type { Plugin } from 'esbuild';

/** One package policy for definition reads, process builds and watched rebuilds.
 * Source workspace entries must be compiled, including their relative imports
 * and decorators. Built packages remain external so runtime DI and module
 * identities are shared with the application installation.
 */
export function externalizeNonRelativePlugin(): Plugin {
  const resolving = Symbol('runtime-package-resolution');
  return {
    name: 'externalize-non-relative',
    setup(build) {
      build.onResolve({ filter: /^[^./]/ }, async (args) => {
        if (args.pluginData?.[resolving]) return undefined;
        // Use the actual import kind and build conditions. require.resolve()
        // cannot identify a package that exposes only an ESM import condition.
        const resolved = await build.resolve(args.path, {
          kind: args.kind, importer: args.importer, resolveDir: args.resolveDir,
          pluginData: { [resolving]: true },
        });
        if (!resolved.errors.length && !resolved.external &&
            ['.ts', '.tsx', '.mts', '.cts'].includes(path.extname(resolved.path).toLowerCase())) {
          return { path: resolved.path, namespace: resolved.namespace, suffix: resolved.suffix };
        }
        // Compiled packages and builtins keep their normal runtime identity.
        // An unresolved package remains external and must exist at runtime.
        return { path: args.path, external: true };
      });
    },
  };
}
