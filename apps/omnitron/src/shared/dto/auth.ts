/**
 * Auth DTOs — the wire shapes of the OmnitronAuth service.
 *
 * These live here, not next to `AuthService`, because the console imports
 * them through `@omnitron-dev/omnitron/dto/services`. When they were declared
 * in `services/auth.service.ts`, that single `import type` pulled the whole
 * server implementation into the webapp's type graph — decorators, Kysely,
 * jose and all — and `tsc -p webapp/tsconfig.json` failed with
 * `TS1206: Decorators are not valid here` on files the console never runs.
 *
 * The DTO barrier only holds if it depends on nothing behind it.
 */

export interface OmnitronSignInRequest {
  username: string;
  password: string;
  /**
   * Client-asserted user agent. Recorded as an unverified claim — the same
   * status a User-Agent header has. There is deliberately no `ipAddress`
   * field: a client-supplied address written to the session table would be
   * forgeable provenance in the operator-facing session list.
   */
  userAgent?: string;
}

export interface OmnitronAuthUser {
  id: string;
  username: string;
  displayName: string | null;
  role: string;
  totpEnabled: boolean;
  pgpEnabled: boolean;
}

export interface OmnitronSessionInfo {
  id: string;
  expiresAt: Date;
}

export interface OmnitronSignInResult {
  user: OmnitronAuthUser;
  session: OmnitronSessionInfo;
  accessToken: string;
}

export interface OmnitronActiveSession {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
  current: boolean;
}
