import { SSHClient } from './sshClient';
import { MockSSHClient } from './mockSSHClient';
import { ISSHClient, SSHConnectionOptions } from '../../types/ssh';

export class SSHClientFactory {
  static createClient(config: SSHConnectionOptions, useMock = false, commandMocks?: Record<string, any>): ISSHClient {
    if (useMock) {
      return new MockSSHClient(commandMocks);
    }
    return new SSHClient(config);
  }
}