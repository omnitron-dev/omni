# @omnitron-dev/titan-lumen

Lumen's Titan integration provides document reads, search, theorem graphs and
controlled authoring through Netron. The AST compiler remains in
`@omnitron-dev/lumen-ast`; transport authentication and invocation isolation
belong to Titan's Netron core.

## Integrating with an existing Titan application

Register `LumenModule.forRoot({ docsDir: '/absolute/docs' })` in the application's
modules, or use `LumenModule.forRootAsync({ useFactory, inject })` for configuration
provided by DI. Resolve `LumenService` and expose it on the application's
Netron peer using `peer.exposeService(app.resolve(LumenService))`. The application owns its
listeners and authentication adapter; Lumen does not need a second HTTP auth
middleware.

The equivalent explicit composition is:

```ts
import { LumenService } from '@omnitron-dev/titan-lumen';

const documents = new LumenService({
  docsDir: '/absolute/docs',
  enablePlayground: false,
});
await netron.peer.exposeService(documents);
```

Configure authentication on the host Netron before opening its listeners. Use the
same application authentication/session provider as other Titan services. Never
accept a role list or `valid: true` in a request as proof of identity.

## Published RPC surface

The service name is `Lumen`. `LumenServiceContract` describes the six network methods:

| Method | Result | Authorization |
| --- | --- | --- |
| `search(query, options?)` | Ranked document hits | Public projection or verified caller's document access |
| `getDocument(path)` | Authorized Markdown or `null` | Document and node access |
| `getSymbolContract(symbol)` | Symbol contract or `null` | Configured source access, internal by default |
| `getTheoremGraph()` | Theorem nodes and edges | Authorized document projection |
| `executePlayground(code)` | Execution result or error | `lumen.playground.execute` |
| `saveLiveEdit(payload)` | Revision or conflict | `lumen.documents.write` |

Grant mutation permissions through the host application's role/permission system.
They are independent: an editor can receive document write access without code
execution access. The same requirements apply to HTTP and WebSocket; missing
identity returns 401 and insufficient permissions return 403.

Netron supplies the admitted identity through `getCurrentInvocationContext()`.
`session` is not part of the wire contract. Extra arguments cannot impersonate an
administrator. Search filters cannot override the verified caller's roles.
`getOptions()` and `getAccessFilterService()` are internal service APIs and are
not published RPC methods.

Direct in-process reads outside an admitted Netron invocation are anonymous.
Mutations require the corresponding admitted service method and a verified
identity. There is one service and one contract; there are no session arguments,
controller wrappers or alternate service tokens. Titan resolves the service and
its `AccessFilterService` and `LiveEditService` collaborators by their classes.
`LUMEN_OPTIONS_TOKEN` is the configuration token.

An empty corpus returns empty results. A missing configured corpus reports an
error on document, search and graph reads; it never substitutes demonstration
documents or symbol contracts.

## MCP on the existing Netron HTTP host

`LumenMcpAdapter` uses the official MCP SDK for protocol negotiation, schemas and
errors. It translates tool/resource calls into the host's native Netron HTTP
entry point in process. Authorization headers and the host-supplied connection
address enter the same authentication, permission and rate-limit path as RPC.
The adapter has no listener, authentication callback or mutable caller session.

```ts
import { HttpNativeServer } from '@omnitron-dev/titan/netron/transport/http';
import { LumenMcpAdapter } from '@omnitron-dev/titan-lumen';

let mcp: LumenMcpAdapter;
const http = new HttpNativeServer({
  host: '127.0.0.1',
  port: 8081,
  customRoutes: [async (request, { remoteAddress }) =>
    new URL(request.url).pathname === '/mcp'
      ? mcp.handleRequest(request, remoteAddress)
      : null],
});
http.setPeer(netron.peer);
mcp = new LumenMcpAdapter({
  http,
  resources: ['guides/start.pdx'],
  allowedHostnames: ['localhost', '127.0.0.1', '[::1]'],
  allowedOriginHostnames: ['localhost', '127.0.0.1', '[::1]'],
});
await http.listen();
```

The adapter publishes `search_corpus`, `get_document`, `lumen_inspect_ast` and
`lumen://corpus/{path}` resources. Resource lists contain only documents readable
by the caller; every read re-enters the service, so no independent content store
can bypass document access. Tool schemas reject undeclared role/session fields.

The endpoint uses stateless Streamable HTTP with JSON responses. POST is the
only accepted method; it does not open persistent SSE sessions. The default
body limit is 1 MiB. Configure host/origin hostname allowlists for the actual
deployment; they default to loopback names. Set `rpcPath` when the host changes
its native invocation route. The host owns TLS, authentication and shutdown.
See the [official TypeScript MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk).

## Qualification status

Server playground calls use the shared Lumen WASM interpreter in a fresh Node
Worker with an empty environment. Netron checks `lumen.playground.execute`
before admitting a call. At most four workers run per service; excess calls
receive 429, and capacity is released only after worker termination. The outer
five-second timer includes initialization. Execution, memory, source and result
limits are enforced by `@omnitron-dev/lumen-ast/execution`; no `node:vm` or host
JavaScript fallback is used. Keep `enablePlayground: false` when execution is
unnecessary; public read access never grants execution permission.

The 0.4.0 audit is in progress. Do not infer that a test with a PDF header,
hydration flag or mock request establishes production readiness. The repository's
`audit/LUMEN-0.4.0.md` records remaining sandbox, document projection, persistence,
and browser integration work. Live edits currently use bounded in-memory state;
durable authoring is still a release blocker. The isolated execution engine has
local negative tests through actual Netron, including memory exhaustion,
constructor escapes and concurrent admission. Browser and final package checks
remain part of the release gate. Nothing in this package's audit
activates changes on running Omnitron controllers or applications.

## Corpus bounds and source visibility

Filesystem documents use canonical relative paths. Symlinks, hidden paths,
`node_modules` and generated `dist` trees are excluded. A missing document is
`null`; a missing configured directory, invalid UTF-8 or failed read is an error.
Search and theorem graphs consume the same complete, deterministic inventory.
The default inventory budget is 10,000 entries, 64 MiB and 32 directory levels;
`corpusLimits` configures these bounds. Documents are limited to 5 MiB and source
files to 2 MiB. Exceeding a bound fails the request rather than returning a
successful partial corpus. Search accepts limits from 0 to 100 and queries of
at most 4 KiB.

`sourceAccess` and `knowledgeBaseAccess` default to `internal`, independently of
public Markdown. Set either to `public` only when that entire configured source
is intended for anonymous readers. Per-entry and section restrictions still
apply to knowledge-base search results. A failed KB query or source scan is
reported explicitly; it does not silently fall back to a different corpus.
