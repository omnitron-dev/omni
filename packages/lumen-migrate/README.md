# @omnitron-dev/lumen-migrate

Create a separate Lumen source project from Docusaurus documentation, and compare static documentation routes and anchors. This tool never starts a server or publishes live site output. Build and publish the resulting project through the normal Lumen builder, which owns release publication and durability.

```sh
lumen-migrate docusaurus /physical/path/docusaurus /physical/path/new-lumen-project --json
lumen-migrate verify /physical/path/docusaurus /physical/path/new-lumen-project --json
lumen-migrate --version
```

The target must not exist, even as an empty directory or broken symlink. Its parent must already exist. Source and target must be separate, non-overlapping physical paths; symlink aliases and symlinks anywhere inside the documentation inventory are refused. Use a new target for each attempt. The source is read only. The CLI does not search test fixtures or invent a project when input is missing.

## Inputs and conversion

The documentation root is `source/docs` when present, otherwise `source`. The complete selected tree is inventoried before migration: regular files, assets and empty directories. Markdown `.md`, `.mdx` and `.pdx` documents become `.pdx`; other files in that tree are copied byte for byte. Conversion preserves frontmatter and custom anchors, normalizes admonitions and relative Markdown links, and removes Docusaurus theme imports. Output path collisions, including case and Unicode normalization collisions, are errors.

Optional `docusaurus.config.{ts,mts,cts,js,mjs,cjs}` and `sidebars.{ts,mts,cts,js,mjs,cjs}` files in the source root are parsed as static data without executing them. More than one candidate for either config is ambiguous and fails. Supported expressions include literals, local constant bindings, static arrays/objects and spreads, TypeScript annotations, `defineConfig(...)`, and literal `require.resolve(...)` references. Malformed syntax, unresolved bindings and computed calls fail. Static expression extraction is limited to 64 levels and 10,000 evaluated entries, including expanded bindings. Simplify dynamic configuration to explicit data before migration.

The generated `lumen.config.ts` carries the supported site metadata, locales, sidebar structure, KaTeX macros and default color mode. Plugin implementations, custom React components, application dependencies, themes, deployment settings and files outside the selected documentation tree are not converted. Review those separately when integrating the new source project; no runnable `package.json` is fabricated.

Admission limits apply to migration, directory parity and sidebar inventory: at most 10,000 entries, 64 nested directory levels, 16 MiB per regular file and 128 MiB total. Documentation/config text must be valid UTF-8 and data-only frontmatter must parse successfully. Shared Lumen frontmatter validation also enforces its document and metadata limits. Unsupported special files, unreadable entries, malformed documents and duplicate canonical routes abort the operation; they are never omitted from a successful report.

## Verification and target creation

Every migration transforms into a private sibling staging directory, then requires complete static route and anchor parity **before** claiming the target. Source files, configuration, directory identities and staged bytes are revalidated before target creation. There is no optional verification or permissive mode.

The target is claimed with exclusive directory creation. Each destination entry is created exclusively, so a competing writer that creates the target first keeps its directory, including an empty one. A final inventory checks that the new project matches the verified stage. Existing target directories are never renamed, replaced, restored or deleted.

Creating a source tree this way is not an atomic directory swap. Other processes may observe an incomplete new target during its copy. If copying or verification fails, the CLI exits nonzero and retains the stage and any claimed target, reporting their exact paths. Inspect them before explicitly removing anything or retrying with a new target. Failed stage cleanup also exits nonzero, even when the target copy is complete; cleanup errors are not hidden. On success, only the migrator's unchanged staging directory is removed.

Parity compares discovered documentation routes and static Markdown/HTML anchors, including frontmatter `slug`/`id`, heading IDs and explicit anchors. It does not run Docusaurus or Lumen, prove rendered component equivalence, check external links, or validate plugin-generated pages. Reports contain measured `routes` and `anchors` with counts and missing entries; `routes.matched` maps each source URL to the actual matching target URL. Empty input is insufficient evidence and fails parity. An unreadable or malformed inventory is an error, not a partial parity report.

## Exit status and library use

Successful migration or verification exits `0`. Missing parity, invalid input, a pre-existing target, races and filesystem failures exit `1`. `--json` emits a migration result with its mandatory `parity` report, a verification report, or `{ "ok": false, "error": "..." }` for an operational error. CLI errors also have a concise stderr diagnostic. Version output comes from the installed package manifest.

The package exports `runLumenMigrateCli`, static configuration/document transformers, `crawlDocumentationDirectory`, `compareDirectories` and `verifyUrlAndAnchorParity`. Invalid filesystem input and malformed metadata throw. Array parity returns `passed: false` for an empty source. `runLumenMigrateCli` sets the exit code on a failed CLI operation and rejects on operational errors; callers must handle the rejection. The command surface is `docusaurus <source> <target> [--json]` and `verify <source> <target> [--json]`.
