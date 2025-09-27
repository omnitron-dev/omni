/**
 * Claude Binary Service
 * Manages finding and verifying the Claude Code executable
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class ClaudeBinaryService {
  private claudePath: string | null = null;
  private searchPaths: string[] = [];

  constructor(private logger: any) {
    this.initializeSearchPaths();
  }

  private initializeSearchPaths(): void {
    const homeDir = os.homedir();
    const platform = os.platform();

    // Common paths where Claude might be installed
    this.searchPaths = [
      // NPM global installations
      path.join(homeDir, '.npm', 'bin', 'claude'),
      '/usr/local/bin/claude',
      '/usr/bin/claude',

      // NVM installations
      ...this.getNvmPaths(homeDir),

      // Homebrew (macOS)
      '/opt/homebrew/bin/claude',
      '/usr/local/opt/claude/bin/claude',

      // Windows paths
      ...(platform === 'win32' ? [
        path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
        path.join(process.env.PROGRAMFILES || '', 'claude', 'claude.exe')
      ] : []),

      // Check PATH environment variable
      ...this.getPathDirs()
    ];
  }

  private getNvmPaths(homeDir: string): string[] {
    const paths: string[] = [];
    const nvmDir = path.join(homeDir, '.nvm', 'versions', 'node');

    if (fs.existsSync(nvmDir)) {
      try {
        const versions = fs.readdirSync(nvmDir);
        for (const version of versions) {
          paths.push(path.join(nvmDir, version, 'bin', 'claude'));
        }
      } catch {
        // Ignore errors
      }
    }

    return paths;
  }

  private getPathDirs(): string[] {
    const pathEnv = process.env.PATH || '';
    return pathEnv.split(path.delimiter)
      .map(dir => path.join(dir, 'claude'))
      .filter(p => p);
  }

  /**
   * Find Claude binary
   */
  async findClaude(): Promise<string> {
    // Return cached path if available
    if (this.claudePath && fs.existsSync(this.claudePath)) {
      return this.claudePath;
    }

    // Try to find Claude in search paths
    for (const searchPath of this.searchPaths) {
      if (fs.existsSync(searchPath)) {
        try {
          // Verify it's executable
          fs.accessSync(searchPath, fs.constants.X_OK);
          this.claudePath = searchPath;
          this.logger?.info('Found Claude binary', { path: searchPath });
          return searchPath;
        } catch {
          // Not executable, continue searching
        }
      }
    }

    // Try using 'which' or 'where' command
    const command = os.platform() === 'win32' ? 'where' : 'which';
    try {
      const result = await this.execCommand(command, ['claude']);
      const foundPath = result.trim().split('\n')[0];
      if (foundPath && fs.existsSync(foundPath)) {
        this.claudePath = foundPath;
        this.logger?.info('Found Claude binary via system command', { path: foundPath });
        return foundPath;
      }
    } catch {
      // Command failed, Claude not in PATH
    }

    throw new Error(
      'Claude Code not found. Please ensure Claude Code is installed and available in your PATH.\n' +
      'You can install it with: npm install -g @anthropic/claude-code'
    );
  }

  /**
   * Check Claude version
   */
  async checkVersion(): Promise<{
    isInstalled: boolean;
    version?: string;
    output: string;
  }> {
    try {
      const claudePath = await this.findClaude();
      const result = await this.execCommand(claudePath, ['--version']);

      // Extract version from output
      const versionMatch = result.match(/(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?)/);
      const version = versionMatch ? versionMatch[1] : undefined;

      return {
        isInstalled: true,
        version,
        output: result.trim()
      };
    } catch (error) {
      return {
        isInstalled: false,
        output: error instanceof Error ? error.message : 'Failed to check Claude version'
      };
    }
  }

  /**
   * Create command with proper environment
   */
  createCommand(args: string[]): {
    command: string;
    args: string[];
    env: NodeJS.ProcessEnv;
  } {
    const claudePath = this.claudePath || 'claude';

    // Set up environment variables
    const env = { ...process.env };

    // Ensure Node.js is available
    if (claudePath.includes('.nvm')) {
      const nodeDir = path.dirname(claudePath);
      const currentPath = env.PATH || '';
      if (!currentPath.includes(nodeDir)) {
        env.PATH = `${nodeDir}:${currentPath}`;
      }
    }

    // Add Homebrew paths on macOS
    if (os.platform() === 'darwin') {
      const homebrewPaths = ['/opt/homebrew/bin', '/usr/local/bin'];
      const currentPath = env.PATH || '';
      for (const brewPath of homebrewPaths) {
        if (!currentPath.includes(brewPath) && fs.existsSync(brewPath)) {
          env.PATH = `${brewPath}:${currentPath}`;
        }
      }
    }

    return {
      command: claudePath,
      args,
      env
    };
  }

  private execCommand(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        env: process.env,
        shell: false
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        reject(error);
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout || stderr);
        } else {
          reject(new Error(stderr || stdout || `Command failed with code ${code}`));
        }
      });
    });
  }
}