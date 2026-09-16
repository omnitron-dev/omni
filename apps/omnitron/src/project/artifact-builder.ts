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
/**
 * Where `pnpm` is, for a process that did not inherit a shell's PATH.
 *
 * The daemon is started by launchd, whose PATH is
 * `…/node/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`
 * — and pnpm's own installer puts the binary in `~/Library/pnpm`, which is on
 * none of those. So every artifact build failed with ENOENT, `buildAll`
 * swallowed it into `console.error`, and the caller logged
 * `Artifacts built for deployment` over an empty list.
 *
 * Resolved once per process and remembered: the answer cannot change while
 * the daemon runs, and the search is a handful of `stat` calls.
 *
 * Returns `pnpm` unchanged when nothing is found, so the failure is an ENOENT
 * naming the command rather than a path this invented.
 */
let pnpmPath: string | null = null;
function resolvePnpm(): string {
  if (pnpmPath) return pnpmPath;

  const home = process.env['HOME'] ?? '';
  const candidates = [
    // The two pnpm installs itself into, in the order it prefers.
    process.env['PNPM_HOME'] ? `${process.env['PNPM_HOME']}/pnpm` : null,
    home ? `${home}/Library/pnpm/pnpm` : null,
    home ? `${home}/.local/share/pnpm/pnpm` : null,
    '/opt/homebrew/bin/pnpm',
    '/usr/local/bin/pnpm',
  ].filter((c): c is string => c !== null);

  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      pnpmPath = candidate;
      return candidate;
    } catch {
      // Not here; try the next.
    }
  }
  return 'pnpm';
}

/** The resolver, for a test that must run on the machine it is about. */
export function resolvePnpmForTests(): string {
  pnpmPath = null;
  return resolvePnpm();
}

export class ArtifactWithoutDependencies extends Error {
  constructor(
    readonly app: string,
    readonly reason: string,
    readonly artifactPath: string,
  ) {
    super(
      `The artifact for '${app}' carries no dependencies and will not start on a node: ${reason}. ` +
        `Its package.json uses pnpm's workspace protocol, which npm cannot resolve, so installing them ` +
        `on the far side is not an option either.`,
    );
    this.name = 'ArtifactWithoutDependencies';
  }
}

export class ArtifactBuilder {
  private readonly outputDir: string;

  constructor(
    private readonly projectRoot: string,
    outputDir?: string
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
      await this.runBuild(appDir, entry.name);
    }

    // 2. Verify dist/ exists
    const distDir = path.join(appDir, 'dist');
    if (!fs.existsSync(distDir)) {
      throw new Error(`No dist/ directory found for ${entry.name}. Build failed?`);
    }

    // 3. Create tarball: dist + package.json + config
    await this.createTarball(appDir, artifactPath, entry.name);

    // 4. Compute checksum
    const checksum = await this.computeChecksum(artifactPath);
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

    for (const entry of entries) {
      if (entry.enabled === false) continue;
      try {
        built.push(await this.buildApp(entry, options));
      } catch (err) {
        failed.push({ app: entry.name, error: (err as Error).message });
      }
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
    for (const stale of ['tsconfig.tsbuildinfo', '.tsbuildinfo']) {
      try {
        fs.rmSync(path.join(appDir, stale), { force: true });
      } catch {
        // Not there, or not ours to remove: the build below is what reports.
      }
    }

    try {
      await exec(resolvePnpm(), ['build'], { cwd: appDir, timeout: 300_000 });
    } catch (err: any) {
      throw new Error(`Build failed for ${appName}: ${err.stderr?.slice(0, 200) ?? err.message}`, { cause: err });
    }
  }

  /**
   * Package an app so it can RUN where it lands.
   *
   * This packed `dist/`, `package.json` and `config/`. The header above says
   * the artifact contains `node_modules/ (production deps only)`; it never
   * did, and the deploy step's `npm install --production 2>/dev/null || true`
   * was supposed to make up the difference on the node.
   *
   * It cannot. Measured on the test node, running that install by hand:
   *
   *     npm error code EUNSUPPORTEDPROTOCOL
   *     npm error Unsupported URL Type "workspace:": workspace:*
   *
   * The app's package.json names 31 dependencies and several are
   * `workspace:*` — a pnpm protocol npm does not implement and never will.
   * So the dependencies could not be installed on any node, ever, and the
   * `|| true` meant nobody found out: `/opt/omnitron/artifacts/daos/main/0.0.1`
   * has `dist/` and no `node_modules/`, and the app cannot start.
   *
   * `pnpm deploy` is the built-in answer to exactly this: it resolves
   * workspace dependencies into a real `node_modules` and writes a directory
   * that stands on its own. `--legacy` because pnpm 10 otherwise requires
   * `inject-workspace-packages`, which is a workspace-wide setting and not
   * this command's to change.
   *
   * Falling back is deliberate and narrow: if `pnpm deploy` is unavailable the
   * old contents are packed and the caller is TOLD the artifact carries no
   * dependencies, rather than shipping the same silent half-artifact under a
   * name that implies otherwise.
   */
  private async createTarball(appDir: string, outputPath: string, appName: string): Promise<void> {
    const os = await import('node:os');
    const fsp = await import('node:fs/promises');
    const pkgName = this.packageNameOf(appDir) ?? appName;
    const staging = await fsp.mkdtemp(path.join(os.tmpdir(), 'omnitron-artifact-'));
    const deployDir = path.join(staging, 'app');

    try {
      await exec(
        resolvePnpm(),
        ['deploy', '--filter', pkgName, '--prod', '--legacy', deployDir],
        { cwd: this.projectRoot, timeout: 600_000 },
      );

      if (!fs.existsSync(path.join(deployDir, 'node_modules'))) {
        throw new Error('pnpm deploy produced no node_modules');
      }

      // `-C deployDir .` so the archive holds the directory's CONTENTS: the
      // node extracts into the artifact directory the deployer already made,
      // and a leading `app/` would put everything one level too deep.
      await exec('tar', ['-czf', outputPath, '-C', deployDir, '.'], { timeout: 300_000 });
    } catch (err) {
      const includes = ['dist', 'package.json'];
      if (fs.existsSync(path.join(appDir, 'config'))) includes.push('config');
      await exec('tar', ['-czf', outputPath, '-C', appDir, ...includes], { timeout: 60_000 });
      throw new ArtifactWithoutDependencies(appName, (err as Error).message, outputPath);
    } finally {
      await fsp.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** The workspace package name `pnpm --filter` needs, from the app's own manifest. */
  private packageNameOf(appDir: string): string | null {
    try {
      return JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf-8')).name ?? null;
    } catch {
      return null;
    }
  }

  private async computeChecksum(filePath: string): Promise<string> {
    const crypto = await import('node:crypto');
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }
}
