# `@omnitron-dev/lint-runner`

This package exists to hold one dependency: **TypeScript 6**.

`typescript-eslint` refuses to load against TypeScript 7 — it reads
`ts.versionMajorMinor` at import time and throws
(`typescript-eslint does not support TS 7.0`, upstream
[#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)).
The whole monorepo is on TypeScript 7, so lint had not run since that upgrade.

The upgrade note TypeScript 7 ships with says to run typescript-eslint against
the TS 6 API side by side. That cannot be arranged with a pnpm override:
`typescript` is a **peer** dependency of typescript-eslint, and pnpm resolves
peers from the importer, so an override — scoped or flat, aliased or not — does
not reach it. Measured, three ways, before this package existed.

What does reach it is an importer that declares TypeScript 6 itself. That is
this package. `pnpm` therefore installs a second TypeScript into
`tools/lint/node_modules`, and the root ESLint config requires
`typescript-eslint` from here rather than from the root, so the copy that loads
is the one bound to 6.0.3.

Nothing else changes: every other package resolves `typescript@7.0.2` exactly
as before.

## Is linting with an older parser safe?

Measured rather than assumed, because the opposite was recorded as fact for a
day: the TypeScript 6 parser reads **781 files across titan, testing,
netron-browser and prism with zero syntax errors**. TypeScript 7.0 is a
reimplementation of the same language, not an extension of its grammar, so
there is nothing in this codebase for a 6.x parser to fail on.

Re-run that check if the language version ever moves:

```bash
node -e "
const ts = require('./node_modules/typescript');
// … parse the tree, count sourceFile.parseDiagnostics
"
```

## When this package can be deleted

When typescript-eslint supports TypeScript 7 (the tracking issue above). At
that point: drop this directory, drop `tools/*` from the workspace globs, and
restore the plain `require('typescript-eslint')` in `eslint.config.cjs`.
