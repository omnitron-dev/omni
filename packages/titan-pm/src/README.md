# Process-management implementation

`@omnitron-dev/titan-pm` manages child processes, pools, supervisors, and worker RPC within Titan applications. Register `ProcessManagerModule.forRoot(options)` or `forRootAsync`, then use the exported manager token and public types.

[The package README](../README.md) covers application setup. This directory maps the implementation boundaries:

| Source | Responsibility |
| --- | --- |
| [Process manager](process-manager.ts) | Spawn, lookup, control, and shutdown |
| [Registry](process-registry.ts) | Managed process records |
| [Spawner](process-spawner.ts) | Child creation and readiness |
| [Pool](process-pool.ts), [supervisor](process-supervisor.ts) | Pool selection and restart policy |
| [Lifecycle queue](lifecycle-queue.ts) | Serialize lifecycle operations |
| [Child contract](child-contract.ts) | Ready, heartbeat, drain, and snapshot messages |
| [Liveness](liveness.ts), [death confirmation](confirm-death.ts) | Process identity and termination evidence |
| [Controller handoff](controller-handoff.ts) | Transfer controller ownership |
| [Worker runtime](worker-runtime.ts) | Decorated worker execution |
| [Workflow](process-workflow.ts) | Stages, compensation, and uncertain outcomes |

A running PID alone does not establish application readiness. Use the managed readiness contract, and await shutdown so owned children and communication resources are accounted for. Restart behavior is controlled by the configured supervisor policy and restart window.

[Public exports](index.ts) include process decorators, configuration tokens, lifecycle types, and health/metrics interfaces. Use those exports rather than importing private files from `src`.
