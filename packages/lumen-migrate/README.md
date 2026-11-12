# @omnitron-dev/lumen-migrate

Create a new Lumen source project from Docusaurus documentation and compare static routes and anchors. The migrator does not serve or publish live output; use the normal Lumen builder for that.

## Capabilities

- Convert Markdown, MDX and PDX documents while retaining frontmatter and anchors.
- Extract supported configuration and sidebars as static data without executing source code.
- Inventory documents and assets before conversion.
- Require route and anchor parity before creating the target project.

## Quick start

```sh
pnpm add -D @omnitron-dev/lumen-migrate
pnpm exec lumen-migrate docusaurus /physical/source /physical/new-project --json
pnpm exec lumen-migrate verify /physical/source /physical/new-project --json
```

The target must not exist, including as an empty directory or symlink, and its parent must exist. Source and target must be separate, non-overlapping physical paths. Symlink aliases and symlinks in the selected tree are refused. The source remains read-only.

## Conversion and verification

The selected tree is `source/docs` when present, otherwise `source`. Documents become `.pdx`; other files are copied byte for byte. Optional Docusaurus configuration and sidebars must be statically readable. Dynamic calls, malformed documents, unreadable entries and output collisions fail the operation.

Custom React components, plugins, themes, dependencies, deployment settings and files outside that tree are not converted. No runnable `package.json` is invented. Review those parts when integrating the new project.

Every migration writes a private staging directory and checks parity before claiming the target with exclusive directory creation. A competing writer's target is never replaced. Creating the new source tree is not an atomic directory swap: a failed copy can leave an incomplete target. Failure returns nonzero and retains the stage and any claimed target with their exact paths for inspection. Cleanup failures are also reported.

Admission is bounded to 10,000 entries, 64 directory levels, 16 MiB per file and 128 MiB total. Parity measures discovered routes and static anchors; it does not execute either site, validate external links or establish rendered component equivalence. Reports contain `routes` and `anchors`. Empty or malformed input cannot produce a successful parity report.

## Documentation

[Library API](src/index.ts) · [CLI commands](src/cli) · [Lumen](../lumen/README.md)

The command surface is `docusaurus <source> <target> [--json]`, `verify <source> <target> [--json]` and `--version`. Verification during migration is mandatory.

## License

[MIT](../../LICENSE).
