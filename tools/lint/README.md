# ESLint compiler dependencies

This private package supplies the JavaScript TypeScript Compiler API used by ESLint plugins. The root [ESLint configuration](../../eslint.config.cjs) resolves those plugins relative to this package, independently of the native compiler used for package builds.

[package.json](package.json) owns the compatible parser, plugin, and Compiler API dependency versions. Update them with the workspace lockfile; do not install a separate dependency tree here.

Run lint from the repository root:

```sh
pnpm lint
pnpm exec eslint packages/titan/src/application/application.ts
```

This directory is tooling only and is not published as an application runtime dependency. See the [root package scripts](../../package.json) for the full lint and typecheck commands.
