import { Client, ConnectConfig } from 'ssh2';

import { OrbitError } from '../errors/error';
import { ISSHClient, SSHCommandResult, SSHCommandOptions, SSHConnectionOptions } from '../../types/ssh';

export class SSHClient implements ISSHClient {
  private client: Client;
  private isConnected: boolean = false;

  constructor(private config: SSHConnectionOptions) {
    this.client = new Client();
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const connectionConfig: ConnectConfig = {
        host: this.config.host,
        port: this.config.port || 22,
        username: this.config.username,
        privateKey: this.config.privateKey,
        passphrase: this.config.passphrase,
        readyTimeout: this.config.timeout || 20000,
      };

      this.client
        .on('ready', () => {
          this.isConnected = true;
          resolve();
        })
        .on('error', err => reject(new OrbitError(`SSH connection error: ${err.message}`, 'SSH_CONNECTION_ERROR')))
        .connect(connectionConfig);
    });
  }

  executeCommand(command: string, options?: SSHCommandOptions): Promise<SSHCommandResult> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected) {
        reject(new OrbitError('SSH client not connected', 'SSH_NOT_CONNECTED'));
        return;
      }

      let timeoutId: NodeJS.Timeout | undefined;

      this.client.exec(command, options || {}, (err, stream) => {
        if (err) {
          reject(new OrbitError(`SSH exec error: ${err.message}`, 'SSH_EXEC_ERROR'));
          return;
        }

        let stdout = '';
        let stderr = '';

        if (options?.timeout) {
          timeoutId = setTimeout(() => {
            stream.close();
            reject(new OrbitError(`SSH command timeout: ${command}`, 'SSH_COMMAND_TIMEOUT'));
          }, options.timeout);
        }

        stream
          .on('close', (exitCode) => {
            if (timeoutId) clearTimeout(timeoutId);
            resolve({ stdout, stderr, exitCode: exitCode ?? 0 });
          })
          .on('data', data => stdout += data.toString())
          .stderr.on('data', data => stderr += data.toString());
      });
    });
  }

  uploadFile(localPath: string, remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected) {
        reject(new OrbitError('SSH client not connected', 'SSH_NOT_CONNECTED'));
        return;
      }

      this.client.sftp((err, sftp) => {
        if (err) {
          reject(new OrbitError(`SFTP error: ${err.message}`, 'SFTP_ERROR'));
          return;
        }

        sftp.fastPut(localPath, remotePath, (err_) => {
          if (err_) {
            reject(new OrbitError(`SFTP upload error: ${err_.message}`, 'SFTP_UPLOAD_ERROR'));
            return;
          }

          resolve();
        });
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.isConnected) {
        this.client.end();
        this.isConnected = false;
      }
      resolve();
    });
  }
}
