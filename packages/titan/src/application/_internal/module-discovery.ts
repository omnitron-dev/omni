/**
 * Internal collaborator — filesystem-based module discovery.
 *
 * Walks one or more roots looking for files that export classes
 * decorated with `@Module` (detected via the `__titanModule` flag the
 * decorator stamps on the constructor). Every discovered class is
 * validated (must have a `name` property when instantiated), registered
 * in the modules map, and returned to the caller.
 *
 * Why a dedicated collaborator? The legacy `Application.discoverModules`
 * was 200 lines of file-walking, glob resolution, import-error
 * classification, and validation — all in one method. Splitting it
 * isolates the I/O surface so the rest of `Application` doesn't pull in
 * `node:fs/promises` and `glob` transitively for callers that never use
 * discovery.
 *
 * Single responsibility: enumerate `@Module` classes from a set of
 * paths, validate them, and register them into the supplied registry.
 * Returns the discovered class list so the orchestrator can decide
 * whether to fully process each via the registry.
 *
 * @internal
 */

import { Errors } from '../../errors/index.js';
import {
  createToken,
  type Token,
} from '../../nexus/index.js';
import type { IModule, ModuleConstructor } from '../../types.js';
import type { ILogger } from '../../modules/logger/index.js';

export interface DiscoveryDeps {
  /** Whether a module token is already known to the registry. */
  has(token: Token<unknown>): boolean;
  /** Push a (token, instance) pair into the module map without going through full register. */
  cacheDiscovered(token: Token<IModule>, instance: IModule): void;
  getLogger(): ILogger | undefined;
}

/**
 * Name a discovered module the way ModuleRegistry does: an explicit `name` on
 * the instance (the IModule object style), then the decorator's metadata,
 * then the class name.
 *
 * Exported because Application.create() re-instantiates each discovered class
 * to key it, and deriving the name a second time by a different rule is how a
 * decorator module ended up tokenised under an empty name.
 */
export function resolveDiscoveredModuleName(
  exported: Function,
  instance: unknown,
  exportName?: string,
): string | undefined {
  const named = instance as { name?: unknown } | undefined;
  if (typeof named?.name === 'string' && named.name) return named.name;

  const metadata = (exported as { __titanModuleMetadata?: { name?: unknown } }).__titanModuleMetadata;
  if (metadata && typeof metadata.name === 'string' && metadata.name) return metadata.name;

  return exported.name || exportName || undefined;
}

export class ModuleDiscovery {
  constructor(private readonly deps: DiscoveryDeps) {}

  /**
   * Scan filesystem locations for module-decorated classes. The legacy
   * defaults (`<cwd>/src|dist|lib/modules`) are used when no paths are
   * supplied. A single glob-style string is resolved with `glob`.
   *
   * `excludePaths` supports `**\/<filename>` style patterns plus simple
   * substring matches — preserved from the legacy implementation.
   *
   * Errors are split into two buckets:
   *   - "critical" syntax errors (truncated files, unbalanced braces)
   *     escalate to a thrown `Errors.internal` so CI catches them.
   *   - Other import / format failures log a warning and continue —
   *     a missing transpile output or non-module file shouldn't break
   *     the application bootstrap.
   *
   * Validation errors that match "missing required" trigger a thrown
   * `Errors.badRequest` because they indicate a module class that was
   * EXPLICITLY tagged with `__titanModule` but doesn't satisfy the
   * contract — that's almost always a programming bug.
   */
  async discover(scanPaths?: string | string[], excludePaths?: string[]): Promise<ModuleConstructor[]> {
    const modules: ModuleConstructor[] = [];
    const validationErrors: Error[] = [];
    const criticalErrors: Error[] = [];
    const logger = this.deps.getLogger();

    const fs = await import('node:fs/promises');
    const pathMod = await import('node:path');
    const { pathToFileURL } = await import('node:url');

    const paths = await this.resolvePaths(scanPaths, pathMod);

    for (const scanPath of paths) {
      let files: string[] = [];
      try {
        // `stat` failing and `stat` succeeding on something that is neither a
        // file nor a directory used to end at the same silent `continue`. The
        // first is a path we could not read — a permission problem on a parent,
        // a broken mount, a dangling symlink — and skipping it means the
        // application boots with modules missing and nothing said anywhere.
        // The sibling branch below logs when a path cannot be scanned; this one
        // did not, so the quieter failure was the one that mattered more.
        let statError: NodeJS.ErrnoException | undefined;
        const stat = await fs.stat(scanPath).catch((err: NodeJS.ErrnoException) => {
          statError = err;
          return null;
        });
        if (stat?.isFile()) {
          files = [scanPath];
        } else if (stat?.isDirectory()) {
          files = await this.findModuleFiles(scanPath, fs, pathMod);
        } else if (statError) {
          logger?.debug(`Scan path could not be read: ${scanPath} (${statError.code ?? statError.message})`);
          continue;
        } else {
          logger?.debug(`Scan path is neither a file nor a directory: ${scanPath}`);
          continue;
        }
      } catch {
        logger?.debug(`Scan path not found: ${scanPath}`);
        continue;
      }

      for (const file of files) {
        if (file.includes('.test.') || file.includes('.spec.')) continue;
        if (this.isExcluded(file, excludePaths)) {
          logger?.debug(`Excluding file from discovery: ${file}`);
          continue;
        }

        try {
          const fileUrl = pathToFileURL(file).href;
          const moduleExports = await import(fileUrl);

          for (const exportName in moduleExports) {
            const exported = moduleExports[exportName];
            if (!exported || typeof exported !== 'function') continue;
            if (!(exported as { __titanModule?: unknown }).__titanModule) continue;

            try {
              const instance = new exported();

              // A class decorated with @Module has no `name` instance
              // property: the decorator records metadata and sets
              // __titanModule, and the name lives in that metadata or in the
              // class itself — which is how ModuleRegistry resolves it. The
              // old check demanded `instance.name` and rejected the entire
              // documented module style as "missing required 'name'
              // property", so titan(), which turns autoDiscovery on
              // unconditionally, could not start an application at all.
              // Nothing that reaches this branch could satisfy the check:
              // only functions carrying __titanModule get here.
              const moduleName = resolveDiscoveredModuleName(exported, instance, exportName);
              if (!moduleName) {
                const error = Errors.badRequest(
                  `Module ${exported.name || exportName} has no resolvable name`,
                );
                validationErrors.push(error);
                logger?.warn(`Invalid module: ${error.message}`);
                continue;
              }
              // The registry keys modules by `instance.name` and hasByName()
              // compares it, so a decorator module has to leave here as a
              // conforming IModule. Normalising it is what this layer is for:
              // turning a decorated class into the shape the registry takes.
              if (!instance.name) {
                Object.defineProperty(instance, 'name', {
                  value: moduleName,
                  enumerable: true,
                  configurable: true,
                  writable: true,
                });
              }

              modules.push(exported as ModuleConstructor);
              logger?.debug(`Discovered module: ${moduleName} from ${file}`);

              const token = createToken<IModule>(moduleName);
              if (!this.deps.has(token)) {
                this.deps.cacheDiscovered(token, instance);
                logger?.debug(`Registered module: ${moduleName}`);
              }
            } catch (err) {
              const error = Errors.internal(
                `Failed to instantiate module ${exported.name}: ${(err as Error).message}`,
              );
              validationErrors.push(error);
              logger?.warn(error.message);
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          // Treat genuine syntax errors as critical; "Unexpected token 'export'"
          // is just a CommonJS-import-of-ESM symptom that we tolerate.
          const isCritical =
            error instanceof Error &&
            (message.includes('Unexpected end of input') ||
              (message.includes('SyntaxError') && !message.includes("Unexpected token 'export'")));
          if (isCritical) {
            criticalErrors.push(error as Error);
            logger?.error(`Critical error loading module from ${file}: ${message}`);
          } else {
            logger?.warn(`Failed to load potential module from ${file}: ${message}`);
          }
        }
      }
    }

    if (validationErrors.length > 0) {
      // Escalate on the kind of failure, not on its wording. This used to
      // throw only when a message contained the substring "missing required",
      // so the single validation error that could escalate was the one whose
      // text happened to match — and a module tagged __titanModule that could
      // not even be constructed was logged at warn level and dropped. Every
      // error collected here is by definition an explicitly tagged module
      // that failed the contract, which is what the class doc calls "almost
      // always a programming bug".
      logger?.warn(`Module discovery found ${validationErrors.length} validation error(s)`);
      const joined = validationErrors.map((e) => e.message).join('; ');
      throw Errors.badRequest(`Module discovery failed: ${joined}`);
    }
    if (criticalErrors.length > 0) {
      const joined = criticalErrors.map((e) => e.message).join('; ');
      throw Errors.internal(
        `Module discovery failed with ${criticalErrors.length} critical error(s): ${joined}`,
      );
    }

    return modules;
  }

  private async resolvePaths(
    scanPaths: string | string[] | undefined,
    pathMod: typeof import('node:path'),
  ): Promise<string[]> {
    if (typeof scanPaths === 'string') {
      if (scanPaths.includes('*')) {
        const glob = (await import('glob')).glob;
        return glob(scanPaths, { absolute: true });
      }
      return [scanPaths];
    }
    if (Array.isArray(scanPaths)) return scanPaths;
    return [
      pathMod.join(process.cwd(), 'src', 'modules'),
      pathMod.join(process.cwd(), 'dist', 'modules'),
      pathMod.join(process.cwd(), 'lib', 'modules'),
    ];
  }

  private isExcluded(file: string, excludePaths: string[] | undefined): boolean {
    if (!excludePaths || excludePaths.length === 0) return false;
    return excludePaths.some((pattern) => {
      if (pattern.includes('**')) {
        const filename = pattern.replace('**/', '');
        return file.endsWith(filename);
      }
      return file.includes(pattern);
    });
  }

  private async findModuleFiles(
    dir: string,
    fs: typeof import('node:fs/promises'),
    pathMod: typeof import('node:path'),
  ): Promise<string[]> {
    const collected: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = pathMod.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        collected.push(...(await this.findModuleFiles(fullPath, fs, pathMod)));
      } else if (
        entry.isFile() &&
        (entry.name.endsWith('.js') ||
          entry.name.endsWith('.ts') ||
          entry.name.endsWith('.cjs') ||
          entry.name.endsWith('.mjs'))
      ) {
        collected.push(fullPath);
      }
    }
    return collected;
  }

}
