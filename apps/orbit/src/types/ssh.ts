export interface SSHConnectionOptions {
  host: string;
  port?: number;
  username: string;
  privateKey?: string;
  passphrase?: string;
  timeout?: number;
}

export interface SSHCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SSHCommandOptions {
  timeout?: number;
  env?: Record<string, string>;
}

export interface ISSHClient {
  connect(): Promise<void>;
  executeCommand(command: string, options?: SSHCommandOptions): Promise<SSHCommandResult>;
  uploadFile(localPath: string, remotePath: string): Promise<void>;
  close(): Promise<void>;
}