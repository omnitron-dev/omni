# Netron core tasks

Core tasks implement peer-control operations below the public service interface. They are dispatched by Netron's [task manager](../task-manager.ts); this directory is not a public package subpath.

| Task | Purpose |
| --- | --- |
| [Authenticate](authenticate.ts) | Validate credentials and establish peer identity |
| [Query interface](query-interface.ts) | Resolve a service and its interface |
| [Expose](expose-service.ts), [unexpose](unexpose-service.ts) | Publish or withdraw a remote service definition |
| [Unref](unref-service.ts) | Release a service reference |
| [Subscribe](subscribe.ts), [unsubscribe](unsubscribe.ts), [emit](emit.ts) | Manage remote event delivery |
| [Invalidate cache](invalidate-cache.ts) | Invalidate peer-side cached data |

Remote service publication is disabled unless the host enables `allowRemoteServiceExposure`. [_guard.ts](_guard.ts) also checks ownership for operations that remove or release definitions. Enabling remote publication requires an appropriate authorization policy.

Application code should use the public peer, service, and event APIs from [Netron](../README.md). Changes here need matching protocol behavior and [core-task regressions](../../../test/netron/core-tasks/), including refusal and cleanup cases.
