# @omnitron-dev/titan-lumen

Lumen's Titan integration provides document reads, search, theorem graphs and
controlled authoring through Netron. The AST compiler remains in
`@omnitron-dev/lumen-ast`; transport authentication and invocation isolation
belong to Titan's Netron core.

## Integrating with an existing Titan application

Register `LumenModule.forRoot({ docsDir: '/absolute/docs' })` in the application's
modules, or use `LumenModule.forRootAsync({ useFactory, inject })` for configuration
provided by DI. Resolve `LumenRpcController` and expose it on the application's
Netron peer using `peer.exposeService(controller)`. The application owns its
listeners and authentication adapter; Lumen does not need a second HTTP auth
middleware.

The equivalent explicit composition is:

```ts
import { LumenRpcController, LumenRpcService } from '@omnitron-dev/titan-lumen';

const documents = new LumenRpcService({
  docsDir: '/absolute/docs',
  enablePlayground: false,
});
await netron.peer.exposeService(new LumenRpcController(documents));
```

Configure authentication on the host Netron before opening its listeners. Use the
same application authentication/session provider as other Titan services. Never
accept a role list or `valid: true` in a request as proof of identity.

## Published RPC surface

The service name is `Lumen`. `ILumenRpcService` describes the six network methods:

| Method | Result | Authorization |
| --- | --- | --- |
| `search(query, options?)` | Ranked document hits | Public projection or verified caller's document access |
| `getDocument(path)` | Authorized Markdown or `null` | Document and node access |
| `getSymbolContract(symbol)` | Symbol contract or `null` | Read operation; source projection qualification is ongoing |
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

`ILumenService` is the in-process contract for trusted adapters. Its optional
`LumenSessionContext` parameter is resolved by the adapter on the server. It must
never be passed through directly from an HTTP body, socket payload or tool
arguments. `LumenRpcService` implements this interface; the network controller
implements `ILumenRpcService`.

## Qualification status

The 0.4.0 audit is in progress. Do not infer that a test with a PDF header,
hydration flag or mock request establishes production readiness. The repository's
`audit/LUMEN-0.4.0.md` records remaining sandbox, document projection, persistence,
MCP and browser integration work. Keep remote playground execution disabled until
the isolated execution engine is qualified. Nothing in this package's audit
activates changes on running Omnitron controllers or applications.
