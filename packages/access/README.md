# @omnitron-dev/access

Role hierarchies and permission policies shared by browsers, servers and workers.
No runtime dependencies, Node built-ins, decorators, network clients or global state.

```ts
import { createRoleHierarchy } from '@omnitron-dev/access/roles';
import { createPermissionChecker } from '@omnitron-dev/access/permissions';

export const roles = createRoleHierarchy({
  reader: { level: 0 },
  author: { level: 1, inherits: ['reader'] },
  reviewer: { level: 2, inherits: ['reader'] },
  owner: { level: 3, inherits: ['author', 'reviewer'], assignable: false },
});

roles.expandRoles('reviewer'); // ['reader', 'reviewer']; rank does not grant author
roles.canModerateRole(['owner'], 'author'); // true; peers cannot moderate each other

const allows = createPermissionChecker(['documents.read', 'media.*'], 'explicit');
allows('media.upload'); // true
allows('documents.read.all'); // false
```

## Choose the surface

| Import | Responsibility |
| --- | --- |
| `@omnitron-dev/access` | Pure role and permission primitives |
| `@omnitron-dev/access/roles` | Application-defined, immutable role hierarchy |
| `@omnitron-dev/access/permissions` | Matching, compiled checks, registry helpers and types |
| `@omnitron-dev/access/platform` | Optional five-role platform preset |

The platform preset provides `user`, `moderator`, `security`, `admin` and
`superadmin`. Security and moderation have separate inheritance. Unknown roles
have rank `-1` and cannot be visibility, moderation or assignment targets.
Expansion preserves independent claims without granting them rank. The retired
`boss` claim expands to `user` for compatibility; service identity is established
by the authentication adapter, never by this hierarchy.

## Matching and enforcement

`hierarchical` (the default) lets a concrete parent grant its descendants:
`documents` grants `documents.read`. `explicit` requires an exact key, `*`, or
a suffix wildcard such as `documents.*`. Colons are literal characters.
Select the mode deliberately at each application boundary. Titan's Netron
helpers use explicit mode; the compatibility `titan-auth/access` entry uses
hierarchical mode by default. Neither migration broadens existing authority.

`createPermissionChecker` snapshots the supplied grants once. It checks exact
keys with a Set and walks dot boundaries for prefixes; it never scans every
grant on each check. Recreate it when the principal or grants change.
`hasAllPermissions`, `hasAnyPermission` and `resolvePermissions` compile once per
call. `resolvePermissions` returns recognised effective keys in registry order;
`expandWildcards` retains concrete grants verbatim for compatibility.

Registry scope, risk and labels are application metadata. Validate grants against
the applicable registry before storing them. Enforce authentication, tenant
ownership, resource state and grant delegation on the server. A browser check
only controls affordances. An assignment list is not an authorization gate:
check the target's current rank, then validate the requested role and ownership.

## Optional integration

JWT/session verification lives in `@omnitron-dev/titan-auth`; pass your hierarchy's
`expandRoleSet` as the shared-session preset's `roleExpander`. Token issuers and
verifiers must share the same definition. Opaque sessions can use the pure policy
without JWT or Titan Auth. Storage, Redis and database adapters are independent.

The package ships ESM and declarations, marks `sideEffects: false`, and exposes
narrow entry points. Importing permission helpers does not instantiate a role
preset. Application-owned adapters and catalogs remain outside the package.

See the [access policy guide](https://omnitron.dev/docs/auth/access-policy) for
configuration, migration and enforcement examples.
