import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

export const REPO_ROOT = resolve(import.meta.dirname, '../../..');

export type CliName = 'lumen' | 'lumen-migrate';
export type CliExecutionMode = 'auto' | 'dist' | 'source';

export interface CliRunOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  stdin?: string | Buffer;
  binPath?: string;
  mode?: CliExecutionMode;
  stripAnsi?: boolean;
}

export interface CliRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  signal: NodeJS.Signals | null;
  combinedOutput: string;
}

export interface CliJsonResult<T> extends CliRunResult {
  data?: T;
  parseError?: Error;
}

function stripAnsiCodes(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '');
}

export class CliRunner {
  private repoRoot: string;

  constructor(repoRoot: string = REPO_ROOT) {
    this.repoRoot = repoRoot;
  }

  resolveCliExecutable(cliName: CliName, options?: CliRunOptions): { execPath: string; initialArgs: string[] } {
    if (options?.binPath) {
      if (!existsSync(options.binPath)) {
        throw new Error(`CLI executable not found at specified binPath: ${options.binPath}`);
      }
      return { execPath: process.execPath, initialArgs: [options.binPath] };
    }

    const mode = options?.mode ?? 'auto';

    const distBinPath = resolve(this.repoRoot, `packages/${cliName}/bin/${cliName}.js`);
    const distJsPath = resolve(this.repoRoot, `packages/${cliName}/dist/cli/index.js`);
    const sourceTsPath = resolve(this.repoRoot, `packages/${cliName}/src/cli/index.ts`);

    if (mode === 'dist' || mode === 'auto') {
      if (existsSync(distBinPath) && existsSync(distJsPath)) {
        return { execPath: process.execPath, initialArgs: [distBinPath] };
      }
    }

    if (mode === 'source' || mode === 'auto') {
      if (existsSync(sourceTsPath)) {
        const entry = cliName === 'lumen-migrate' ? 'runLumenMigrateCli' : 'runLumenCli';
        return { execPath: process.execPath, initialArgs: ['--import', 'tsx', '--input-type=module', '--eval',
          `const { ${entry} } = await import(${JSON.stringify(pathToFileURL(sourceTsPath).href)}); await ${entry}(process.argv.slice(1));`, '--'] };
      }
    }

    throw new Error(`No ${mode} CLI entry for ${cliName} in ${this.repoRoot}`);
  }

  async run(cliName: CliName, args: string[], options: CliRunOptions = {}): Promise<CliRunResult> {
    const cwd = options.cwd ?? this.repoRoot;
    const timeoutMs = options.timeoutMs ?? 30_000;
    const stripAnsi = options.stripAnsi ?? true;

    let execResolution: { execPath: string; initialArgs: string[] };
    try {
      execResolution = this.resolveCliExecutable(cliName, options);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        exitCode: 1,
        stdout: '',
        stderr: errorMsg,
        durationMs: 0,
        timedOut: false,
        signal: null,
        combinedOutput: errorMsg,
      };
    }

    const { execPath, initialArgs } = execResolution;
    const fullArgs = [...initialArgs, ...args];

    const childEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      NODE_ENV: 'test',
      ...(options.env ?? {}),
    };

    const startTime = Date.now();
    let timedOut = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let combinedBuffer = '';

    return new Promise<CliRunResult>((resolvePromise) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(execPath, fullArgs, {
          cwd,
          env: childEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (spawnError: unknown) {
        const durationMs = Date.now() - startTime;
        const msg = spawnError instanceof Error ? spawnError.message : String(spawnError);
        resolvePromise({
          exitCode: 1,
          stdout: '',
          stderr: msg,
          durationMs,
          timedOut: false,
          signal: null,
          combinedOutput: msg,
        });
        return;
      }

      let forceKillTimer: NodeJS.Timeout | null = null;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        forceKillTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL');
          }
        }, 2_000);
        forceKillTimer.unref();
      }, timeoutMs);

      child.stdin?.end(options.stdin);

      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString('utf8');
        stdoutBuffer += text;
        combinedBuffer += text;
      });

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString('utf8');
        stderrBuffer += text;
        combinedBuffer += text;
      });

      child.on('error', (err: Error) => {
        clearTimeout(timer);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        const durationMs = Date.now() - startTime;
        const errMsg = err.message;
        resolvePromise({
          exitCode: 1,
          stdout: stripAnsi ? stripAnsiCodes(stdoutBuffer) : stdoutBuffer,
          stderr: stripAnsi ? stripAnsiCodes(stderrBuffer + '\n' + errMsg) : stderrBuffer + '\n' + errMsg,
          durationMs,
          timedOut,
          signal: null,
          combinedOutput: stripAnsi ? stripAnsiCodes(combinedBuffer + '\n' + errMsg) : combinedBuffer + '\n' + errMsg,
        });
      });

      child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
        clearTimeout(timer);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        const durationMs = Date.now() - startTime;

        const stdout = stripAnsi ? stripAnsiCodes(stdoutBuffer) : stdoutBuffer;
        const stderr = stripAnsi ? stripAnsiCodes(stderrBuffer) : stderrBuffer;
        const combinedOutput = stripAnsi ? stripAnsiCodes(combinedBuffer) : combinedBuffer;

        resolvePromise({
          exitCode: code,
          stdout,
          stderr,
          durationMs,
          timedOut,
          signal,
          combinedOutput,
        });
      });
    });
  }

  async runJson<T>(cliName: CliName, args: string[], options: CliRunOptions = {}): Promise<CliJsonResult<T>> {
    const result = await this.run(cliName, args, options);
    try {
      const data = JSON.parse(result.stdout) as T;
      return { ...result, data };
    } catch (parseError: unknown) {
      return {
        ...result,
        parseError: parseError instanceof Error ? parseError : new Error(String(parseError)),
      };
    }
  }

  runLumen(args: string[], options?: CliRunOptions): Promise<CliRunResult> {
    return this.run('lumen', args, options);
  }

  runLumenCheck(options?: CliRunOptions & { json?: boolean; gates?: string[] }): Promise<CliRunResult> {
    const args: string[] = ['check'];
    if (options?.json) {
      args.push('--json');
    }
    if (options?.gates?.length) {
      args.push('--gates', options.gates.join(','));
    }
    return this.run('lumen', args, options);
  }

  runLumenBuild(options?: CliRunOptions & { outputDir?: string }): Promise<CliRunResult> {
    const args: string[] = ['build'];
    if (options?.outputDir) {
      args.push('--outDir', options.outputDir);
    }
    return this.run('lumen', args, options);
  }

  runLumenMigrate(
    sourceDir: string,
    targetDir: string,
    options?: CliRunOptions & { json?: boolean }
  ): Promise<CliRunResult> {
    const args: string[] = ['docusaurus', sourceDir, targetDir];
    if (options?.json) args.push('--json');
    return this.run('lumen-migrate', args, options);
  }
}

export const cliRunner = new CliRunner();
