# @omnitron-dev/lumen-ast

Pure isomorphic prism-doc/2 AST compiler, math environments, KaTeX macro registry, Shiki/Twoslash highlighter, and multi-target emitters for Omnitron Lumen.

## Frontmatter trust boundary

`parseSafeFrontmatter` is shared by the compiler, Titan integration and migrator. It accepts data-only YAML or JSON, including BOM and CRLF input, and runs in Node and browsers. Unsupported engines, malformed metadata, invalid declared fields, cyclic structures and exceeded limits produce error diagnostics and `access: 'restricted'`. A recovered document body is for authoring diagnostics; it must never be published without authorization.

Limits: 10 MiB per document, 64 KiB frontmatter, 16 metadata nesting levels and 10,000 expanded metadata values. The migrator rejects blocking diagnostics before committing staged output.

## One access projection for every output

Parse once with `parseDocument` (async API) or `parseDocumentSync`, then project
before rendering, indexing or exporting:

```ts
import { parseDocument, createDocumentAccessPredicate, projectDocumentAccess, toHtmlSsr } from '@omnitron-dev/lumen-ast';

const ast = await parseDocument(source, 'guide.pdx');
const audience = createDocumentAccessPredicate(verifiedRoles, { grants: roleGrants });
const projected = projectDocumentAccess(ast, audience);
if (!projected.allowed) return null;
return toHtmlSsr(projected.ast);
```

The default classifications are `public`, `internal` and `confidential`.
Undeclared access is public. Malformed/unknown classifications and documents
with parser error diagnostics are denied, including for administrators. The
shared `@omnitron-dev/access` hierarchy and permission checker implement role
grants; use `DocumentAccessOptions` to supply your application's policy.
Permission names are not accepted as role names. A caller with explicit verified
permissions can pass them as the third argument to `createDocumentAccessPredicate`.

Every declaration restricts access: a public child cannot override a private
parent. A heading governs its complete section until the next heading of equal
or higher level. HTML nesting across Markdown paragraphs and inline text is
resolved with the standard HTML5 parser before authorization. The projected AST
contains neither the original raw document nor authoring diagnostics. It can be
passed to HTML, Markdown, Typst, search and MCP consumers without reimplementing
filtering. Authorized Markdown exports retain document classification metadata.

Authored HTML is parsed using `hast-util-raw` and rendered with
`hast-util-sanitize`; scripts, event handlers and unsafe URLs are not executable.
Code examples remain literal, including nested fences and directive attributes.
