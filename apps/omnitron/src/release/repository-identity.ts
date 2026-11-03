/** Repository names are public provenance, never a transport credential store. */
export const REPOSITORY_IDENTITY_ERROR =
  'Release repository identity is unsafe or invalid; use a credential-free Git remote without query or fragment parameters';

export class RepositoryIdentityError extends Error {
  constructor() { super(REPOSITORY_IDENTITY_ERROR); this.name = 'RepositoryIdentityError'; }
}

/** Preserve identity bytes exactly. Credentials must live in Git's credential helper or SSH
 * agent; stripping them here would silently change evidence already pinned by a digest. */
export function isSafeRepositoryIdentity(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.trim() !== value || /\p{Cc}/u.test(value)) return false;
  // Explicit paths cannot be mistaken for a URL or scp-style authority. Git permits spaces,
  // question marks and @ in path names; they are not transport parameters in these forms.
  if (/^(?:\/|\.\.?\/|~\/|[A-Za-z]:[\\/])/.test(value)) return true;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) {
    try {
      const url = new URL(value);
      if (!['https:', 'http:', 'ssh:', 'git:', 'git+ssh:', 'git+https:', 'git+http:', 'file:'].includes(url.protocol) ||
          /[?#\\]/.test(value) || url.password) return false;
      const authority = value.slice(value.indexOf('://') + 3).split('/')[0]!;
      const userinfo = authority.includes('@') ? authority.slice(0, authority.lastIndexOf('@')) : '';
      // Even an empty password separator is forbidden. HTTP tokens often occupy username.
      if (userinfo.includes(':') || (url.username && !['ssh:', 'git+ssh:'].includes(url.protocol))) return false;
      return url.protocol === 'file:' ? !url.username : !!url.hostname;
    } catch { return false; }
  }
  if (value.includes('://') || /^(?:https?|ssh|git|file):/i.test(value) || /^[A-Za-z][A-Za-z0-9+.-]*::/.test(value)) return false;
  // Git treats a slash before the colon as a relative local path, not an scp authority.
  if (value.includes('/') && value.indexOf('/') < value.indexOf(':')) return true;
  if (value.includes(':')) {
    // Git's scp syntax has a username, never a password. Reject the ambiguous password form
    // instead of treating its first colon as the host/path separator.
    if (/[?#\\]/.test(value) || /^[^/:]+:[^/]*@[^/:]+:/.test(value)) return false;
    return /^(?:[^/@:\s]+@)?(?:\[[0-9A-Fa-f:]+\]|[^/@:\s]+):.+$/.test(value);
  }
  return true;
}

export function assertRepositoryIdentity(value: unknown): asserts value is string {
  if (!isSafeRepositoryIdentity(value)) throw new RepositoryIdentityError();
}

/** Also used before structural parsing, so legacy unsafe manifests receive a safe refusal. */
export function assertReleaseRepositoryIdentities(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RepositoryIdentityError();
  const manifest = value as Record<string, unknown>;
  for (const key of ['project', 'omni']) {
    const source = manifest[key];
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new RepositoryIdentityError();
    assertRepositoryIdentity((source as Record<string, unknown>)['repo']);
  }
}
