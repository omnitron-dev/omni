import { extname } from 'path';
import * as yaml from 'js-yaml';
import { ZodSchema } from 'zod';
import { existsSync, readFileSync } from 'fs';

export class FileLoader {
  static loadFile<T = any>(path: string, schema?: ZodSchema<T>): T {
    if (!existsSync(path)) {
      throw new Error(`File not found: ${path}`);
    }

    const content = readFileSync(path, 'utf-8');
    const data = FileLoader.parseContent(content, extname(path));

    if (schema) {
      return schema.parse(data);
    }

    return data as T;
  }

  static fileExists(path: string): boolean {
    return existsSync(path);
  }

  private static parseContent(content: string, extension: string): any {
    if (['.yaml', '.yml'].includes(extension)) {
      return yaml.load(content);
    } else if (extension === '.json') {
      return JSON.parse(content);
    } else {
      throw new Error(`Unsupported file extension: ${extension}`);
    }
  }
}
