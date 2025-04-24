import * as fs from 'fs';

export class CLIUtils {
  static fileExists(path: string): boolean {
    return fs.existsSync(path);
  }

  static validateFileExtension(path: string, extensions: string[]): boolean {
    return extensions.some(ext => path.endsWith(ext));
  }

  static parseJsonFile<T>(path: string): T {
    const content = fs.readFileSync(path, 'utf-8');
    return JSON.parse(content) as T;
  }
}