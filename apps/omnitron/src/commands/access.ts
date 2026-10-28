import { createDaemonClient } from '../daemon/daemon-client.js';
import type { IOmnitronAccessService, ConsoleRole } from '../shared/dto/services.js';
import { isOmnitronRole } from '../shared/roles.js';
import { readSecretFromStdin } from './node.js';
import { emitError, emitJson } from './output.js';

export async function accessCommand(
  action: 'show' | 'users' | 'create' | 'role' | 'revoke',
  options: {
    id?: string;
    username?: string;
    role?: string;
    expect?: string;
    displayName?: string;
    after?: string;
  } = {}
): Promise<void> {
  const client = createDaemonClient();
  try {
    const service = await client.service<IOmnitronAccessService>('OmnitronAccess');
    let result: unknown;
    if (action === 'show') result = await service.describe();
    else if (action === 'users') result = await service.listUsers(options.after ? { after: options.after } : {});
    else if (action === 'revoke') result = await service.revokeSessions({ id: options.id! });
    else {
      if (!isOmnitronRole(options.role)) throw new Error('Role must be viewer, operator or admin');
      const role: ConsoleRole = options.role;
      if (action === 'role') {
        await service.setRole({ id: options.id!, role, previous: options.expect! });
        result = { id: options.id, role, sessionsRevoked: true };
      } else {
        const password = await readSecretFromStdin('initial password', 'Console');
        result = await service.createUser({
          username: options.username!,
          role,
          password,
          ...(options.displayName ? { displayName: options.displayName } : {}),
        });
      }
    }
    if (!emitJson(result)) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    emitError((error as Error).message);
    process.exitCode = 1;
  } finally {
    await client.disconnect();
  }
}
