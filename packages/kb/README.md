# @omnitron-dev/kb

Extract TypeScript API knowledge and compose indexing, embedding and discovery services. The extraction CLI can run at build time; Titan integration is available separately.

## Capabilities

- Source, decorator, dependency and repository-map extraction through ts-morph.
- Separate `./extractors`, `./embeddings`, `./specs`, `./discovery` and `./surreal` entry points.
- Optional Titan integration through `./titan`.

## Quick start

```sh
pnpm add @omnitron-dev/kb
```

Create `kb/kb.config.ts` in a TypeScript package with a `tsconfig.json`:

```ts
import { defineKnowledge } from '@omnitron-dev/kb';

export default defineKnowledge({
  module: 'example',
  name: 'Example API',
  tags: ['api'],
  extract: { symbols: true, decorators: [], entryPoints: ['src/index.ts'] },
  specs: './specs',
});
```

```sh
pnpm exec kb-extract --root /path/to/package --out ./kb/generated
```

The CLI writes symbols, decorators, dependencies, a repository map and a manifest to the selected output directory. `--out` is relative to the invoking directory; `--root` selects the package to inspect.

The published package includes its extraction toolchain. The repository's `kb:extract` and `kb:index` tasks are workspace commands, not additional installed CLI subcommands.

## Documentation

[Extraction command](src/cli/extract.ts) · [Public API](src/index.ts) · [Exports](package.json)

## License

[MIT](../../LICENSE).
