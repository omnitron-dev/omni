import { readFile, readdir } from 'node:fs/promises';
import { resolve, extname, relative } from 'node:path';
import { SpecsParser } from './parser.js';
import type { ISpecDoc, IGotchaDoc, IPatternDoc, IKbSource } from '../core/types.js';

export interface ISpecsCollection {
  specs: ISpecDoc[];
  gotchas: IGotchaDoc[];
  patterns: IPatternDoc[];
}

/**
 * Manages loading and organizing specs from kb/ directories.
 */
export class SpecsManager {
  private readonly parser = new SpecsParser();

  /**
   * Load all specs from a KB source's specs directory.
   */
  async loadFromSource(source: IKbSource): Promise<ISpecsCollection> {
    const specsDir = resolve(source.path, source.config.specs);
    const result: ISpecsCollection = { specs: [], gotchas: [], patterns: [] };

    try {
      await this.walkDirectory(specsDir, specsDir, source, result);
    } catch {
      // specs directory may not exist yet
    }

    return result;
  }

  /**
   * Load specs from the built-in cross-cutting content directory.
   */
  async loadBuiltinSpecs(contentDir: string): Promise<ISpecsCollection> {
    const result: ISpecsCollection = { specs: [], gotchas: [], patterns: [] };

    try {
      await this.walkDirectory(contentDir, contentDir, null, result);
    } catch {
      // content directory may not exist
    }

    return result;
  }

  /**
   * Recursively walk a directory and parse all .md files.
   */
  private async walkDirectory(
    dir: string,
    baseDir: string,
    source: IKbSource | null,
    result: ISpecsCollection,
  ): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);

      if (entry.isDirectory()) {
        await this.walkDirectory(fullPath, baseDir, source, result);
        continue;
      }

      if (!entry.isFile() || extname(entry.name) !== '.md') continue;

      const content = await readFile(fullPath, 'utf-8');
      const relPath = relative(baseDir, fullPath);
      const dirName = relative(baseDir, dir);

      // Route to appropriate parser based on directory name
      if (dirName.includes('gotcha')) {
        const gotcha = this.parser.parseGotcha(content, relPath);
        if (source && !gotcha.module) {
          gotcha.module = source.config.module;
        }
        result.gotchas.push(gotcha);
      } else if (dirName.includes('pattern')) {
        result.patterns.push(this.parser.parsePattern(content, relPath));
      } else {
        const spec = this.parser.parseSpec(content, relPath);
        if (source && spec.module === relPath.replace(/\.md$/i, '').replace(/\\/g, '/')) {
          // If module was inferred from path, use the source's module instead
          spec.module = source.config.module;
        }
        result.specs.push(spec);
      }
    }
  }
}
