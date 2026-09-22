/**
 * Publishing the packages a release is built from, without publishing them
 * to the wrong place.
 *
 * `daos` reaches into omni through 112 absolute `link:` paths into one
 * developer's home directory, committed to the repository, and 122 more in
 * its lockfile. No other machine can install it, which is why its CI has
 * never run: there was nothing for a runner to install. The way out is a
 * registry — the packages get versions, the project depends on versions, and
 * any machine can build it.
 *
 * That makes publishing a thing this daemon does, and publishing is the one
 * operation here that is irreversible and outward-facing. Three measurements
 * from 2026-09-22 say what has to be true before it runs:
 *
 *   - `@omnitron-dev/titan` and `@omnitron-dev/common` already exist on the
 *     PUBLIC npm registry, latest 0.2.0, published 2026-05-16;
 *   - the local packages are also 0.2.0, four months of commits later, so
 *     one version already names two different trees;
 *   - `~/.npmrc` on the machine that would run this holds an auth token for
 *     `registry.npmjs.org`.
 *
 * Those three together mean an accidental `pnpm -r publish` here does not
 * fail — it succeeds, outward, into a scope that is already public, using a
 * credential that is already loaded. Nothing in the repository prevents it:
 * no package is `private`, none carries a `publishConfig`, and `.npmrc`
 * scopes nothing.
 *
 * So this module refuses by default and is explicit about what it refuses.
 */

/** Where a publish is allowed to go, and what it is allowed to carry. */
export interface PublishTarget {
  /** The registry URL, as it will be written into a scoped `.npmrc` line. */
  readonly registry: string;
  /** The scope these packages live under, with its leading `@`. */
  readonly scope: string;
}

export type PublishDecision =
  | { readonly action: 'publish'; readonly because: string }
  | { readonly action: 'refuse'; readonly because: string };

/**
 * Hosts that are never a destination for these packages.
 *
 * Named rather than derived: «not the configured registry» is already the
 * rule below, and this list exists so the refusal for the one host that
 * would actually accept them says WHY rather than «host mismatch».
 */
const PUBLIC_REGISTRIES = ['registry.npmjs.org', 'registry.yarnpkg.com'];

export function decidePublish(target: PublishTarget): PublishDecision {
  let url: URL;
  try {
    url = new URL(target.registry);
  } catch {
    return { action: 'refuse', because: `'${target.registry}' is not a registry address` };
  }

  if (PUBLIC_REGISTRIES.includes(url.host)) {
    return {
      action: 'refuse',
      because:
        `${url.host} is the public registry, and '${target.scope}' is already published there by someone — ` +
        `a publish to it replaces public code or adds to it, and neither is what an internal release means`,
    };
  }

  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    // A token travels in a header on every request this makes.
    return { action: 'refuse', because: `${target.registry} is not https, and the publish token travels with each request` };
  }

  if (!target.scope.startsWith('@')) {
    return { action: 'refuse', because: `'${target.scope}' is not a scope — a scoped registry line needs one` };
  }

  return { action: 'publish', because: `${url.host} for ${target.scope}` };
}

/**
 * The `.npmrc` a publish runs with, and nothing else.
 *
 * Written to the build directory rather than the home one, and handed to npm
 * through `npm_config_userconfig` so that `~/.npmrc` is not consulted at all
 * — the machine that will run this has a `registry.npmjs.org` token in it,
 * and a build that cannot see a credential cannot use it by mistake.
 *
 * The token is NOT passed through the environment. Any process of the same
 * user can read another's environment — `ps eww <pid>` is how the shutdown
 * window was verified on this very machine today — so an environment
 * variable holding a publish token is readable for as long as the build
 * runs.
 */
export function npmrcFor(target: PublishTarget, token: string): string {
  const url = new URL(target.registry);
  const path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  const bare = `${url.host}${path}`;
  return [
    `${target.scope}:registry=${url.protocol}//${bare}`,
    `//${bare}:_authToken=${token}`,
    '//' + bare + ':always-auth=true',
    '',
  ].join('\n');
}

/**
 * What a publish command may print.
 *
 * `npm config list` and `pnpm config list` print the contents of every
 * config they loaded, tokens included, and a build log is a file that
 * outlives the build. Measured today from a different pipe: connection
 * strings of the form `redis://user:pass@host` reached the daemon log
 * verbatim, so this is not hypothetical carelessness.
 */
export function redactTokens(text: string): string {
  return text
    .replace(/(_authToken\s*=\s*)\S+/gi, '$1«redacted»')
    .replace(/(:\/\/[^/\s:]+:)[^@\s]+(@)/g, '$1«redacted»$2');
}
