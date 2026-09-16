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
  async buildAll(entries: IEcosystemAppEntry[], options?: BuildOptions): Promise<ArtifactInfo[]> {
    const results: ArtifactInfo[] = [];
    for (const entry of entries) {
      if (entry.enabled === false) continue;
      try {
        const info = await this.buildApp(entry, options);
        results.push(info);
      } catch (err) {
        console.error(`Failed to build ${entry.name}: ${(err as Error).message}`);
      }
    }
    return results;
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

  private async runBuild(appDir: string, appName: string): Promise<void> {
    try {
      await exec('pnpm', ['build'], { cwd: appDir, timeout: 120_000 });
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
        'pnpm',
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
