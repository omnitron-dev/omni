import {
  mkdtempSync,
  rmSync,
  cpSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative } from 'node:path';
import { REPO_ROOT } from './cli-runner.js';

export type KnownFixtureName =
  | 'minimal-lumen'
  | 'full-featured-doc'
  | 'docusaurus-classic'
  | 'docusaurus-multilingual'
  | 'corrupted-projects/broken-cross-links'
  | 'corrupted-projects/broken-anchors'
  | 'corrupted-projects/cyclic-math-dependencies'
  | 'corrupted-projects/invalid-config'
  | 'corrupted-projects/corrupted-frontmatter';

export interface LoadFixtureOptions {
  prefix?: string;
  exclude?: string[];
  overrideFiles?: Record<string, string>;
  validateIntegrity?: boolean;
}

export interface IsolatedFixture {
  readonly name: string;
  readonly originalPath: string;
  readonly fixtureDir: string;
  cleanup(): Promise<void>;
  readFile(relativePath: string): Promise<string>;
  readJson<T = unknown>(relativePath: string): Promise<T>;
  writeFile(relativePath: string, content: string): Promise<void>;
  writeJson(relativePath: string, data: unknown, indent?: number): Promise<void>;
  exists(relativePath: string): boolean;
  listFiles(subDir?: string): Promise<string[]>;
  resolvePath(...paths: string[]): string;
}

const BLACKLIST_PATTERNS = [
  [100, 97, 111, 115],
  [112, 114, 105, 99, 101, 118, 101, 114, 115, 101],
  [112, 97, 121, 115, 121, 115],
  [104, 111, 108, 111, 110],
  [118, 101, 114, 117, 109],
  [1076, 1072, 1086, 1089],
  [111, 122, 97, 114],
  [115, 121, 110, 97, 114, 99],
].map((chars) => new RegExp(chars.map((c) => String.fromCodePoint(c)).join('[\\s._/\\\\-]*'), 'iu'));

function checkBlacklistViolation(text: string): boolean {
  const normalized = text.normalize('NFKC').toLowerCase();
  return BLACKLIST_PATTERNS.some((pattern) => pattern.test(normalized));
}

export class FixtureLoader {
  private repoRoot: string;

  constructor(repoRoot: string = REPO_ROOT) {
    this.repoRoot = repoRoot;
  }

  async validateFixtureIntegrity(dirPath: string): Promise<{ valid: boolean; violations: string[] }> {
    const violations: string[] = [];

    const crawl = (currentDir: string) => {
      const entries = readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(currentDir, entry.name);
        const relPath = relative(dirPath, fullPath);

        if (checkBlacklistViolation(entry.name)) {
          violations.push(`Blacklisted term in filename: ${relPath}`);
        }

        if (entry.isDirectory()) {
          crawl(fullPath);
        } else if (entry.isFile()) {
          try {
            const content = readFileSync(fullPath, 'utf8');
            if (checkBlacklistViolation(content)) {
              violations.push(`Blacklisted term in content: ${relPath}`);
            }
          } catch {
            // Non-utf8 binary file, skip content text check
          }
        }
      }
    };

    if (existsSync(dirPath)) {
      crawl(dirPath);
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }

  async loadFixture(
    fixtureName: KnownFixtureName | string,
    options: LoadFixtureOptions = {}
  ): Promise<IsolatedFixture> {
    const originalPath = resolve(this.repoRoot, 'tests/e2e/fixtures', fixtureName);
    if (!existsSync(originalPath)) {
      throw new Error(`Fixture not found: "${fixtureName}" at expected path: ${originalPath}`);
    }

    if (options.validateIntegrity !== false) {
      const integrity = await this.validateFixtureIntegrity(originalPath);
      if (!integrity.valid) {
        throw new Error(`Fixture integrity violation in "${fixtureName}":\n${integrity.violations.join('\n')}`);
      }
    }

    const prefix = options.prefix ?? 'lumen-e2e-';
    const tempDir = mkdtempSync(join(tmpdir(), prefix));

    const excludes = new Set(['.git', 'node_modules', 'dist', '.turbo', '.DS_Store', ...(options.exclude ?? [])]);

    cpSync(originalPath, tempDir, {
      recursive: true,
      filter: (src) => {
        const base = src.split(/[\\/]/).pop();
        return !excludes.has(base ?? '');
      },
    });

    if (options.overrideFiles) {
      for (const [relPath, content] of Object.entries(options.overrideFiles)) {
        const dest = resolve(tempDir, relPath);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, content, 'utf8');
      }
    }

    let isCleanedUp = false;

    const fixture: IsolatedFixture = {
      name: fixtureName,
      originalPath,
      fixtureDir: tempDir,

      async cleanup(): Promise<void> {
        if (isCleanedUp) return;
        isCleanedUp = true;
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      },

      async readFile(relativePath: string): Promise<string> {
        const target = resolve(tempDir, relativePath);
        return readFileSync(target, 'utf8');
      },

      async readJson<T = unknown>(relativePath: string): Promise<T> {
        const content = await this.readFile(relativePath);
        return JSON.parse(content) as T;
      },

      async writeFile(relativePath: string, content: string): Promise<void> {
        const target = resolve(tempDir, relativePath);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content, 'utf8');
      },

      async writeJson(relativePath: string, data: unknown, indent: number = 2): Promise<void> {
        await this.writeFile(relativePath, JSON.stringify(data, null, indent));
      },

      exists(relativePath: string): boolean {
        return existsSync(resolve(tempDir, relativePath));
      },

      async listFiles(subDir: string = ''): Promise<string[]> {
        const base = resolve(tempDir, subDir);
        if (!existsSync(base)) return [];
        const results: string[] = [];
        const scan = (dir: string) => {
          for (const item of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, item.name);
            if (item.isDirectory()) {
              scan(p);
            } else {
              results.push(relative(tempDir, p));
            }
          }
        };
        scan(base);
        return results;
      },

      resolvePath(...paths: string[]): string {
        return resolve(tempDir, ...paths);
      },
    };

    return fixture;
  }

  async withFixture<T>(
    fixtureName: KnownFixtureName | string,
    fn: (fixture: IsolatedFixture) => Promise<T>,
    options?: LoadFixtureOptions
  ): Promise<T> {
    const fixture = await this.loadFixture(fixtureName, options);
    try {
      return await fn(fixture);
    } finally {
      await fixture.cleanup();
    }
  }

  async createCustomFixture(files: Record<string, string>, options: LoadFixtureOptions = {}): Promise<IsolatedFixture> {
    const prefix = options.prefix ?? 'lumen-custom-';
    const tempDir = mkdtempSync(join(tmpdir(), prefix));

    for (const [relPath, content] of Object.entries(files)) {
      const dest = resolve(tempDir, relPath);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, content, 'utf8');
    }

    if (options.validateIntegrity !== false) {
      const integrity = await this.validateFixtureIntegrity(tempDir);
      if (!integrity.valid) {
        rmSync(tempDir, { recursive: true, force: true });
        throw new Error(`Custom fixture integrity violation:\n${integrity.violations.join('\n')}`);
      }
    }

    let isCleanedUp = false;

    const customFixture: IsolatedFixture = {
      name: 'custom-fixture',
      originalPath: tempDir,
      fixtureDir: tempDir,

      async cleanup(): Promise<void> {
        if (isCleanedUp) return;
        isCleanedUp = true;
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      },

      async readFile(relativePath: string): Promise<string> {
        return readFileSync(resolve(tempDir, relativePath), 'utf8');
      },

      async readJson<T = unknown>(relativePath: string): Promise<T> {
        return JSON.parse(await customFixture.readFile(relativePath)) as T;
      },

      async writeFile(relativePath: string, content: string): Promise<void> {
        const target = resolve(tempDir, relativePath);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content, 'utf8');
      },

      async writeJson(relativePath: string, data: unknown, indent: number = 2): Promise<void> {
        await customFixture.writeFile(relativePath, JSON.stringify(data, null, indent));
      },

      exists(relativePath: string): boolean {
        return existsSync(resolve(tempDir, relativePath));
      },

      async listFiles(subDir: string = ''): Promise<string[]> {
        const base = resolve(tempDir, subDir);
        if (!existsSync(base)) return [];
        const results: string[] = [];
        const scan = (dir: string) => {
          for (const item of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, item.name);
            if (item.isDirectory()) {
              scan(p);
            } else {
              results.push(relative(tempDir, p));
            }
          }
        };
        scan(base);
        return results;
      },

      resolvePath(...paths: string[]): string {
        return resolve(tempDir, ...paths);
      },
    };

    return customFixture;
  }
}

export const fixtureLoader = new FixtureLoader();
export const withFixture = fixtureLoader.withFixture.bind(fixtureLoader);
export const loadFixture = fixtureLoader.loadFixture.bind(fixtureLoader);
