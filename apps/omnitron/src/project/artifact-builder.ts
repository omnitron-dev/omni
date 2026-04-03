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

  private async createTarball(appDir: string, outputPath: string, _appName: string): Promise<void> {
    // Include: dist/, package.json, config/ (if exists)
    const includes = ['dist', 'package.json'];
    if (fs.existsSync(path.join(appDir, 'config'))) includes.push('config');

    await exec('tar', [
      '-czf', outputPath,
      '-C', appDir,
      ...includes,
    ], { timeout: 60_000 });
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
