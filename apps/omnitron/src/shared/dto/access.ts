export type ConsoleRole = 'viewer' | 'operator' | 'admin';

export interface ConsoleCapability {
  service: string;
  method: string;
  roles: string[];
  allowed: boolean;
  /** Dynamic policies require invocation arguments; never grant them speculatively. */
  conditional: boolean;
  /** True only when the published method explicitly allows anonymous calls. */
  anonymous?: boolean;
}

export interface ConsoleAccess {
  userId: string;
  role: ConsoleRole;
  roles: Array<{ role: ConsoleRole; label: string; description: string }>;
  capabilities: ConsoleCapability[];
}

export interface ConsoleAccount {
  id: string;
  username: string;
  displayName: string | null;
  role: string;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface IOmnitronAccessService {
  describe(): Promise<ConsoleAccess>;
  listUsers(data?: { after?: string }): Promise<{ users: ConsoleAccount[]; next: string | null }>;
  createUser(data: {
    username: string;
    displayName?: string;
    password: string;
    role: ConsoleRole;
  }): Promise<ConsoleAccount>;
  setRole(data: { id: string; role: ConsoleRole; previous: string }): Promise<void>;
  revokeSessions(data: { id: string }): Promise<{ revoked: number }>;
}
