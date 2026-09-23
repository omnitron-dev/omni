/**
 * An app's environment as it may be shown: secrets replaced, everything else
 * as it is.
 *
 * `omnitron env main` printed all twelve values in clear — JWT_SECRET (64
 * characters) and DATABASE_URL with its password among them — and `inspect`
 * masked by KEY NAME only, so the password inside `DATABASE_URL`
 * (`postgres://postgres:<password>@…`) was printed by the command that
 * claimed to mask. The daemon answered both with the raw values, to anyone
 * with the operator role.
 *
 * One function now decides, and the daemon applies it before the values
 * leave (`getEnv`); the clear values are a separate, admin-only, audited
 * call (`revealEnv`).
 */

/** Names that hold a secret whatever their value looks like. */
const SECRET_KEY = /secret|passw(or)?d|token|key|credential|private|mnemonic|seed|salt/i;

export const REDACTED = '***';

/**
 * The value with every credential it carries replaced: the password part of
 * `scheme://user:password@host`, and a `password=` / `token=` / `secret=` /
 * `key=` query parameter.
 */
export function redactValue(value: string): string {
  return value
    .replace(/(\/\/[^/@\s:]*:)[^/@\s]*@/g, `$1${REDACTED}@`)
    .replace(/([?&](?:[a-z_]*password|[a-z_]*token|[a-z_]*secret|[a-z_]*key)=)[^&#\s]*/gi, `$1${REDACTED}`);
}

export function redactEnv(env: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    out[key] = SECRET_KEY.test(key) ? REDACTED : redactValue(value);
  }
  return out;
}
