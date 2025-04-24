import { OrbitError } from '../errors/error';
import { SSHClientFactory } from '../execution/sshClientFactory';
import { SSHCommandResult, SSHCommandOptions } from '../../types/ssh';

export interface SSHExecutorOptions {
  host: string;
  username: string;
  port?: number;
  privateKeyPath?: string;
  password?: string;
  timeout?: number;
}

export class SSHTaskExecutor {
  private createSSHClient() {
    return SSHClientFactory.createClient({
      host: this.options.host,
      username: this.options.username,
      port: this.options.port,
      privateKey: this.options.privateKeyPath,
      timeout: this.options.timeout,
    });
  }

  constructor(private options: SSHExecutorOptions) { }

  async executeCommand(command: string, commandOptions?: SSHCommandOptions): Promise<SSHCommandResult> {
    const sshClient = this.createSSHClient();
    await sshClient.connect();
    try {
      const result = await sshClient.executeCommand(command, commandOptions);
      if (result.exitCode !== 0) {
        throw new OrbitError('SSH_COMMAND_FAILED', `Command failed: ${command}`, {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        });
      }
      return result;
    } finally {
      await sshClient.close();
    }
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    const sshClient = this.createSSHClient();
    await sshClient.connect();
    try {
      await sshClient.uploadFile(localPath, remotePath);
    } finally {
      await sshClient.close();
    }
  }
}
