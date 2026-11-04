import path from 'node:path';
import { realpath } from 'node:fs/promises';
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
        if (path.isAbsolute(args.path) || args.pluginData?.[resolving]) return undefined;
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
        if (!resolved.errors.length && !resolved.external && resolved.namespace === 'file') {
          // A bundled workspace library may own a dependency that the app does
          // not declare, or a different version of one the app also imports.
          // Preserve that resolver result instead of resolving the bare name
          // again from the generated bundle. Relative paths keep this local
          // build movable with its installation and retain one module identity.
          const outfile = build.initialOptions.outfile;
          if (!outfile) throw new Error('Runtime package resolution requires one output file');
          const output = path.resolve(build.initialOptions.absWorkingDir ?? process.cwd(), outfile);
          // Node resolves an imported output file through directory symlinks.
          // esbuild already resolves package files physically: computing from a
          // lexical project alias would therefore add the wrong number of '..'.
          // Both callers create the output directory before building.
          const outputDirectory = await realpath(path.dirname(output));
          const relative = path.relative(outputDirectory, resolved.path);
          if (path.isAbsolute(relative)) throw new Error('Runtime dependencies and output must share a filesystem volume');
          // ESM specifiers are URLs; require() paths are filesystem names.
          const urlImport = args.kind === 'import-statement' || args.kind === 'dynamic-import';
          const specifier = relative.split(path.sep).map(part => urlImport ? encodeURIComponent(part) : part).join('/');
          return { path: specifier.startsWith('.') ? specifier : `./${specifier}`, external: true, suffix: resolved.suffix };
        }
        // Compiled packages and builtins keep their normal runtime identity.
        // An unresolved package remains external and must exist at runtime.
        return { path: args.path, external: true };
      });
    },
  };
}
