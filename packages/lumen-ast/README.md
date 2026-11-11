# @omnitron-dev/lumen-ast

Pure isomorphic prism-doc/2 AST compiler, math environments, KaTeX macro registry, Shiki/Twoslash highlighter, and multi-target emitters for Omnitron Lumen.

## Frontmatter trust boundary

`parseSafeFrontmatter` is shared by the compiler, Titan integration and migrator. It accepts data-only YAML or JSON, including BOM and CRLF input, and runs in Node and browsers. Unsupported engines, malformed metadata, invalid declared fields, cyclic structures and exceeded limits produce error diagnostics and `access: 'restricted'`. A recovered document body is for authoring diagnostics; it must never be published without authorization.

Limits: 10 MiB per document, 64 KiB frontmatter, 16 metadata nesting levels and 10,000 expanded metadata values. The migrator rejects blocking diagnostics before committing staged output.
