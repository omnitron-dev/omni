/**
 * Artifact Builder — Builds and packages apps for remote deployment
 *
 * For production environments, omnitron:
 * 1. Builds the app (pnpm build or tsc)
 * 2. Packages dist/ + node_modules + package.json into a tarball
 * 3. Transfers to remote node via SSH (xec SFTP)
 * 4. Remote omnitron extracts and starts
 *
 * The seed project stays on the developer's machine — only compiled
 * artifacts are deployed to production nodes.
 *
 * Artifact structure:
 *   /opt/omnitron/artifacts/<project>/<app>/<version>/
 *   ├── dist/           (compiled JS)
 *   ├── node_modules/   (production deps only)
 *   ├── package.json
 *   └── config/         (omnitron-generated, no secrets in files)
 */

import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { IEcosystemAppEntry } from '../config/types.js';
import { isVendorableRange, type PackageManifest } from '../services/local-bundle.js';
import { resolvePnpm, resolvePnpmForTests } from '../shared/pnpm.js';
import { clearBuildInfo } from '../services/bundle-builder.js';

export { resolvePnpmForTests };

const exec = promisify(execFile);

// =============================================================================
// Types
// =============================================================================

export interface ArtifactInfo {
  app: string;
  version: string;
  path: string; // Local tarball path
  size: number;
  builtAt: string;
  checksum: string;
}

export interface BuildOptions {
  /** Skip npm install (use existing node_modules) */
  skipInstall?: boolean;
  /** Skip tsc build (use existing dist/) */
  skipBuild?: boolean;
  /** Output directory for artifacts */
  outputDir?: string;
}

// =============================================================================
// Builder
// =============================================================================

/**
 * The artifact was built, and it cannot run where it lands.
 *
 * Thrown rather than logged so a caller cannot report a deployment as
 * successful: an artifact with no dependencies installs fine, extracts fine,
 * and fails at the first import — which is the least useful moment to learn
 * it.
 */
export class ArtifactWithoutDependencies extends Error {
  constructor(
    readonly app: string,
    readonly reason: string,
    readonly artifactPath: string,
  ) {
    super(
      `The artifact for '${app}' carries no dependencies and will not start on a node: ${reason}. ` +
        `Its package.json names them with pnpm's workspace protocol and with \`link:\` paths, neither of ` +
        `which npm can resolve on the far side — they have to be packed here or they do not travel.`,
    );
    this.name = 'ArtifactWithoutDependencies';
  }
}

/**
 * Refuse an artifact that only works on the machine that built it.
 *
 * Three ways a build can produce one, all of them silent, all of them cheap
 * to rule out here and expensive to find on a node:
 *
 *   - a symlink that resolves outside the artifact. This is what shipped for
 *     weeks: `ls` listed every `@omnitron-dev/*` entry and `ls <entry>/`
 *     answered `No such file or directory`, because the target was ten `..`
 *     segments up, in a home directory the node does not have.
 *   - a dependency range that still names a directory. `workspace:*` and
 *     `link:…` are instructions to symlink, and `npm` on the node either
 *     refuses them outright or makes another link to nothing.
 *   - an override pointing at a tarball that was not packed. Then the install
 *     succeeds, resolves the package from the REGISTRY, and the node runs a
 *     published version of code this bundle exists to replace.
 *
 * Thrown rather than logged: an artifact is a file, and a file that is wrong
 * in these ways is indistinguishable from a good one until something imports
 * it.
 */
export function assertNothingEscapes(bundleDir: string): void {
  const root = fs.realpathSync(bundleDir);
  const escaping: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        let target: string;
        try {
          target = fs.realpathSync(full);
        } catch {
          // A link that resolves to nothing at all — dangling here and
          // dangling there.
          escaping.push(`${path.relative(root, full)} -> ${fs.readlinkSync(full)} (broken)`);
          continue;
        }
        if (target !== root && !target.startsWith(root + path.sep)) {
          escaping.push(`${path.relative(root, full)} -> ${target}`);
        }
        continue;
      }
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(root);

  const manifestPath = path.join(root, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
    dependencies?: Record<string, string>;
    overrides?: Record<string, string>;
  };

  const unresolved: string[] = [];
  const missingTarballs: string[] = [];
  for (const [group, entries] of Object.entries({
    dependencies: manifest.dependencies ?? {},
    overrides: manifest.overrides ?? {},
  })) {
    for (const [name, range] of Object.entries(entries)) {
      if (isVendorableRange(range)) {
        unresolved.push(`${group}.${name} = ${range}`);
        continue;
      }
      if (!range.startsWith('file:')) continue;
      const rel = range.slice('file:'.length).replace(/^\.\//, '');
      if (!fs.existsSync(path.join(root, rel))) missingTarballs.push(`${group}.${name} -> ${rel}`);
    }
  }

  const problems = [
    ...escaping.map((e) => `symlink leaves the artifact: ${e}`),
    ...unresolved.map((u) => `dependency still names a directory: ${u}`),
    ...missingTarballs.map((m) => `override points at a tarball that was not packed: ${m}`),
  ];
  if (problems.length > 0) {
    throw new Error(`This artifact would not run anywhere but here:\n  ${problems.join('\n  ')}`);
  }
}

export class ArtifactBuilder {
  private readonly outputDir: string;

  /**
   * Tarballs packed during the current `buildAll`.
   *
   * Set for the duration of that call and cleared after it, so two
   * deployments never share one — see `packCache` in `BuildBundleOptions`.
   */
  private packCache: Map<string, string> | null = null;

  constructor(
    private readonly projectRoot: string,
    outputDir?: string,
    /**
     * Where to report progress.
     *
     * Packing twenty-one packages is the longest phase of a deployment and
     * it wrote nothing anywhere: the daemon log went quiet for minutes
     * between `Starting remote stack` and the first transfer, which reads
     * exactly like a hang. An operator watching the console had no way to
     * tell the two apart.
     */
    private readonly logger?: { info(msg: string): void } | undefined,
  ) {
    this.outputDir = outputDir ?? path.join(projectRoot, '.omnitron', 'artifacts');
    fs.mkdirSync(this.outputDir, { recursive: true });
  }

  /**
   * Build an app artifact (tarball) ready for remote deployment.
   */
  async buildApp(entry: IEcosystemAppEntry, options?: BuildOptions): Promise<ArtifactInfo> {
    const appDir = this.resolveAppDir(entry);
    if (!appDir) throw new Error(`Cannot resolve app directory for ${entry.name}`);

    const version = await this.getVersion(appDir);
    const artifactName = `${entry.name}-${version}.tar.gz`;
    const artifactPath = path.join(this.outputDir, artifactName);

    // 1. Build TypeScript
    if (!options?.skipBuild) {
      // Said before it starts, not after. Compiling one app takes minutes on
      // a loaded machine, it writes nothing of its own, and it is the FIRST
      // thing a deployment does — so the daemon log went silent between
      // `Starting remote stack` and the first `packing` line, for six apps
      // in a row, which reads exactly like a hang. Measured during one: `tsc`
      // for a single app at four and a half minutes, with nothing in the log
      // to say so.
      this.logger?.info(`building ${entry.name}`);
      await this.runBuild(appDir, entry.name);
    }

    // 2. Verify dist/ exists
    const distDir = path.join(appDir, 'dist');
    if (!fs.existsSync(distDir)) {
      throw new Error(`No dist/ directory found for ${entry.name}. Build failed?`);
    }

    // 3. Create tarball: dist + package.json + config, and take the
    //    artifact's identity from the bundle rather than from the archive —
    //    see `bundleChecksum`.
    const checksum = await this.createTarball(appDir, artifactPath, entry.name);
    const stat = fs.statSync(artifactPath);

    return {
      app: entry.name,
      version,
      path: artifactPath,
      size: stat.size,
      builtAt: new Date().toISOString(),
      checksum,
    };
  }

  /**
   * Build all apps in the project.
   */
  /**
   * Build every app, and say which ones did not build.
   *
   * This caught each failure and wrote it to `console.error` — which in a
   * daemon goes nowhere anyone reads — then returned the apps that worked.
   * With all six failing, the caller received `[]` and logged
   * `Artifacts built for deployment`, and the deployment proceeded to ship
   * nothing to a node that then had nothing to run.
   *
   * The failures come back with the successes now. A caller that wants to
   * continue past them still can; a caller that reports success cannot do it
   * without looking.
   */
  async buildAll(
    entries: IEcosystemAppEntry[],
    options?: BuildOptions,
  ): Promise<{ built: ArtifactInfo[]; failed: Array<{ app: string; error: string }> }> {
    const built: ArtifactInfo[] = [];
    const failed: Array<{ app: string; error: string }> = [];

    this.packCache = new Map();
    try {
      for (const entry of entries) {
        if (entry.enabled === false) continue;
        try {
          built.push(await this.buildApp(entry, options));
        } catch (err) {
          failed.push({ app: entry.name, error: (err as Error).message });
        }
      }
    } finally {
      this.packCache = null;
    }

    return { built, failed };
  }

  /**
   * List available artifacts.
   */
  listArtifacts(): ArtifactInfo[] {
    if (!fs.existsSync(this.outputDir)) return [];
    return fs.readdirSync(this.outputDir)
      .filter((f) => f.endsWith('.tar.gz'))
      .map((f) => {
        const match = f.match(/^(.+?)-(.+?)\.tar\.gz$/);
        if (!match) return null;
        const stat = fs.statSync(path.join(this.outputDir, f));
        return {
          app: match[1]!,
          version: match[2]!,
          path: path.join(this.outputDir, f),
          size: stat.size,
          builtAt: stat.mtime.toISOString(),
          checksum: '',
        };
      })
      .filter(Boolean) as ArtifactInfo[];
  }

  /**
   * Clean old artifacts, keeping only the latest N per app.
   */
  cleanOldArtifacts(keep = 3): number {
    const artifacts = this.listArtifacts();
    const byApp = new Map<string, ArtifactInfo[]>();

    for (const a of artifacts) {
      const list = byApp.get(a.app) ?? [];
      list.push(a);
      byApp.set(a.app, list);
    }

    let removed = 0;
    for (const [, list] of byApp) {
      // Sort by date desc, remove oldest beyond `keep`
      list.sort((a, b) => b.builtAt.localeCompare(a.builtAt));
      for (let i = keep; i < list.length; i++) {
        try {
          fs.unlinkSync(list[i]!.path);
          removed++;
        } catch { /* already removed */ }
      }
    }

    return removed;
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  private resolveAppDir(entry: IEcosystemAppEntry): string | null {
    // Derive app directory from bootstrap/script path
    const entryFile = entry.bootstrap ?? entry.script;
    if (!entryFile) return null;

    const absPath = path.resolve(this.projectRoot, entryFile);
    // Walk up to find package.json
    let dir = path.dirname(absPath);
    while (dir !== path.parse(dir).root) {
      if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
      dir = path.dirname(dir);
    }
    return path.dirname(absPath);
  }

  private async getVersion(appDir: string): Promise<string> {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf-8'));
      return pkg.version ?? '0.0.0';
    } catch {
      return '0.0.0';
    }
  }

  /**
   * Build the app, and make sure the build has something to do.
   *
   * A `composite: true` project keeps `tsconfig.tsbuildinfo` beside its
   * config, and tsc trusts it: if the inputs have not changed since that file
   * was written, it emits nothing and exits zero. The usual `build` script is
   * `rm -rf dist && tsc`, which removes the OUTPUT and leaves the record
   * saying the output is current.
   *
   * So the build succeeds, `dist/` stays empty, and the next step fails with
   * `No dist/ directory found for messaging. Build failed?` — a question mark
   * that turns out to be the right punctuation, because the build did not
   * fail. Measured: `pnpm build` in that app exits zero with `dist` at zero
   * files; deleting `tsconfig.tsbuildinfo` first gives sixteen.
   *
   * Removed here rather than in each app's script: an artifact build is a
   * from-scratch build by definition — nothing about the machine that ran the
   * last one is evidence about this one — and fixing it per app means fixing
   * it again for every app added later.
   */
  private async runBuild(appDir: string, appName: string): Promise<void> {
    // Two spellings were removed here and the workspace uses four: a
    // `tsconfig.build.json` points `tsBuildInfoFile` at
    // `node_modules/.tmp/`, and `tsc` also leaves one inside `dist`. Missing
    // one is missing all of them, because any surviving record is enough for
    // tsc to decide there is nothing to do. See `clearBuildInfo`.
    clearBuildInfo(appDir);

    // And the output itself, because `tsc` only writes — it never removes.
    //
    // A deleted source leaves its compiled file in `dist` forever, and
    // anything that reads that directory as a SET rather than by name keeps
    // reading it. Measured on `@daos/paysys`: 34 migrations in `src`, 40 in
    // `dist`, and the artifact ran `002_add_financial_indexes` — a migration
    // whose source had been replaced by `002_deposit_worker_columns` — which
    // failed on `column "sender_asset_id" does not exist` and stopped the
    // app from starting. A removed migration kept being applied.
    //
    // Done here rather than in each app's build script for the same reason
    // the build record is: an artifact build is a from-scratch build by
    // definition, nothing about the last one is evidence about this one, and
    // fixing it per app means fixing it again for every app added later.
    // Clearing the record above is what makes this safe — `rm -rf dist`
    // alone leaves tsc believing the output it just deleted is current.
    try {
      fs.rmSync(path.join(appDir, 'dist'), { recursive: true, force: true });
    } catch {
      // Not there, or not ours: the build below is what reports.
    }

    try {
      await exec(resolvePnpm(), ['build'], { cwd: appDir, timeout: 300_000 });
    } catch (err: any) {
      // Everything the child said, in the order a reader wants it. `stderr`
      // alone produced `Build failed for paysys: ` — an empty string, because
      // `tsc` writes its diagnostics to STDOUT and `pnpm` writes the exit
      // code to stderr only when it feels like it. A build that failed for a
      // reason nobody can read is a build nobody can fix: the reason was
      // `'"@omnitron-dev/titan-database"' has no exported member named
      // 'ResilientPgClient'`, and it sat in `stdout` while the error said
      // nothing at all.
      const said = [err.stdout, err.stderr]
        .map((s: unknown) => (typeof s === 'string' ? s.trim() : ''))
        .filter(Boolean)
        .join('\n')
        .slice(-1500);
      const how = err.code !== undefined ? ` (exit ${err.code})` : err.signal ? ` (killed by ${err.signal})` : '';
      throw new Error(`Build failed for ${appName}${how}: ${said || err.message || 'the build said nothing'}`, {
        cause: err,
      });
    }
  }

  /**
   * Package an app so it can RUN where it lands.
   *
   * Two earlier shapes of this, and why neither worked:
   *
   * It first packed `dist/`, `package.json` and `config/`, with the header
   * above promising `node_modules/ (production deps only)`. The difference
   * was to be made up on the node by
   * `npm install --production --ignore-scripts 2>/dev/null || true`, which
   * could not work even once — the manifests use pnpm's `workspace:`
   * protocol and npm answers `EUNSUPPORTEDPROTOCOL` — and the `|| true` meant
   * nobody found out.
   *
   * It then used `pnpm deploy --prod --legacy`, whose whole purpose is to
   * write a tree that stands on its own. It does, for dependencies that come
   * from a registry or from this repository. It cannot for the ones declared
   * `link:/Users/…/omni/packages/titan` — a `link:` is an instruction to
   * symlink a directory, and pnpm carried it out faithfully: twenty-three
   * symlinks per artifact, each climbing ten `..` segments past `/` into a
   * home directory that exists on one machine. The guard here was
   * `existsSync(node_modules)`, and a directory full of dangling symlinks
   * exists.
   *
   * `--legacy` was itself the warning. Without it pnpm 10 refuses and asks
   * for `inject-workspace-packages`, which is the setting that makes a deploy
   * self-contained; the flag silenced the refusal and produced the tree the
   * refusal was about.
   *
   * So the artifact is built the way the daemon's own bundle is built, by the
   * same functions: every dependency that names a directory — `workspace:` or
   * `link:` — is packed with `pnpm pack` into `vendor/`, the manifest is
   * rewritten to install those tarballs, and `npm install` runs ON THE NODE.
   * That is also the only way the platform-specific packages come out right:
   * this machine has `@esbuild/darwin-arm64` and the node needs
   * `@esbuild/linux-x64`, and the only computer that knows which is which is
   * the one being installed on.
   */
  private async createTarball(appDir: string, outputPath: string, appName: string): Promise<string> {
    const os = await import('node:os');
    const fsp = await import('node:fs/promises');
    const {
      buildBundle,
      archiveBundle,
      bundleChecksum,
      isBuildRecord,
      withoutBuildVersion,
      findWorkspaceRoot,
      linkedWorkspaceRoots,
    } = await import('../services/bundle-builder.js');

    const manifest = this.manifestOf(appDir);
    const pkgName = manifest?.name ?? appName;
    const staging = await fsp.mkdtemp(path.join(os.tmpdir(), 'omnitron-artifact-'));
    const bundleDir = path.join(staging, 'bundle');

    try {
      // The app's own repository, which is not necessarily omnitron's: this
      // builder runs inside the daemon and builds somebody else's project.
      const appWorkspace = findWorkspaceRoot(appDir);
      if (!appWorkspace) {
        throw new Error(`${appDir} is not inside a pnpm workspace — nothing declares what its packages are.`);
      }

      await buildBundle({
        workspaceRoot: appWorkspace,
        rootPackage: pkgName,
        outDir: bundleDir,
        // What an app ships. `webapp/dist` is the daemon's console and has no
        // meaning here; `config/` does, because an app reads it at startup.
        include: ['dist', 'config', 'README.md'],
        ...(manifest ? { additionalWorkspaceRoots: linkedWorkspaceRoots(manifest) } : {}),
        ...(this.packCache ? { packCache: this.packCache } : {}),
        ...(this.logger ? { logger: { info: (m: string) => this.logger!.info(`${appName}: ${m}`) } } : {}),
      });

      assertNothingEscapes(bundleDir);
      // Before packing: what the node compares against is these files, not
      // the container they travel in — and not the note the bundle carries
      // about when it was made, which is new on every build by definition.
      const checksum = await bundleChecksum(bundleDir, { skip: isBuildRecord, rewrite: withoutBuildVersion });
      await archiveBundle(bundleDir, outputPath);
      return checksum;
    } catch (err) {
      const includes = ['dist', 'package.json'];
      if (fs.existsSync(path.join(appDir, 'config'))) includes.push('config');
      await exec('tar', ['-czf', outputPath, '-C', appDir, ...includes], {
        timeout: 60_000,
        env: { ...process.env, COPYFILE_DISABLE: '1' },
      });
      throw new ArtifactWithoutDependencies(appName, (err as Error).message, outputPath);
    } finally {
      await fsp.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** The app's own manifest — its name, and the ranges that say what must travel. */
  private manifestOf(appDir: string): PackageManifest | null {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf-8')) as PackageManifest;
      return parsed.name ? parsed : null;
    } catch {
      return null;
    }
  }
}
