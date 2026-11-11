import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuthContext } from './auth/types.js';

/** Verified identity admitted by Netron, never taken from RPC arguments. */
export type InvocationAuthContext = Readonly<Omit<AuthContext, 'roles' | 'permissions' | 'scopes'>> & {
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly scopes?: readonly string[];
};

/** Server-owned invocation metadata shared by HTTP and persistent transports. */
export interface NetronInvocationContext {
  readonly serviceName?: string;
  readonly methodName: string;
  readonly transport?: string;
  readonly peerId?: string;
  readonly requestId?: string;
  readonly auth?: InvocationAuthContext;
}

interface InvocationResponseContext {
  metadata: Map<string, unknown>;
  requestHeaders?: Record<string, string>;
}

interface InvocationFrame {
  invocation?: NetronInvocationContext;
  peer?: object;
  authority?: AuthContext;
  response?: InvocationResponseContext;
}

// One frame for identity and transport response effects. Application wrappers
// (for example RLS) can compose with it without holding identity on a singleton.
const storage = new AsyncLocalStorage<InvocationFrame>();

/** Undefined outside a Netron invocation; an anonymous invocation has no auth. */
export function getCurrentInvocationContext(): NetronInvocationContext | undefined {
  return storage.getStore()?.invocation;
}

/** @internal Transport dispatch only: the caller must already be authorized. */
export function runWithInvocationContext<T>(
  input: Omit<NetronInvocationContext, 'auth'> & { auth?: AuthContext; peer?: object },
  fn: () => T,
): T {
  const { peer, auth, ...metadata } = input;
  // Pin authorization dimensions even if a login or an adapter later replaces
  // the connection's identity. Do not mutate the authentication adapter's data.
  const authority: AuthContext | undefined = auth && {
    ...auth,
    roles: [...auth.roles],
    permissions: [...auth.permissions],
    ...(auth.scopes ? { scopes: [...auth.scopes] } : {}),
  };
  if (authority) {
    Object.freeze(authority.roles);
    Object.freeze(authority.permissions);
    if (authority.scopes) Object.freeze(authority.scopes);
    Object.freeze(authority);
  }
  const invocation = Object.freeze({ ...metadata, ...(authority ? { auth: authority } : {}) });
  // Deliberately synchronous: an extra Promise hop changes stream admission
  // ordering. Async work created by fn inherits this frame through ALS.
  return storage.run({ invocation, peer, authority }, fn);
}

/** @internal Preserve the distinction between an anonymous frame and no frame. */
export function getInvocationAuthority(peer: object): { auth: AuthContext | undefined } | undefined {
  const frame = storage.getStore();
  return frame?.peer === peer ? { auth: frame.authority } : undefined;
}

/** @internal Token issuance remains a transport response effect, not authority. */
export function runWithInvocationResponseContext<T>(response: InvocationResponseContext, fn: () => T): T {
  return storage.run({ ...storage.getStore(), response }, fn);
}

/** @internal */
export function getInvocationResponseContext(): InvocationResponseContext | undefined {
  return storage.getStore()?.response;
}
