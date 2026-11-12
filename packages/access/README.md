# @omnitron-dev/access

Pure role hierarchies, permission matching and session policies for servers, browsers and workers. Applications provide identity and enforcement; this package evaluates policy without network or storage dependencies.

## Capabilities

- Immutable role hierarchies with explicit inheritance and assignment rules.
- Permission checks in explicit or hierarchical mode.
- Optional platform roles and MFA, session-age and timezone-aware session policies.

## Quick start

```sh
pnpm add @omnitron-dev/access
```

```ts
import { createPermissionChecker } from '@omnitron-dev/access/permissions';

const allows = createPermissionChecker(['documents.read', 'media.*'], 'explicit');
console.log(allows('documents.read')); // true
console.log(allows('documents.write')); // false
```

`explicit` requires an exact grant, `*`, or a suffix wildcard. The default `hierarchical` mode also grants descendants of a concrete parent. Choose the mode at each boundary and rebuild a compiled checker when grants change.

Use `./roles` for application-defined hierarchies, `./platform` for the optional platform preset, and `./session-policy` for pure session evaluation. Unknown or malformed policy controls fail closed. A browser check controls presentation; server handlers still enforce authentication, tenant ownership and current permissions.

## Documentation

[Access policy guide](https://omnitron.dev/docs/auth/access-policy) · [Public API](src/index.ts) · [Exports](package.json)

## License

[MIT](../../LICENSE).
