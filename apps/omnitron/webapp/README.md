# Omnitron Console

The management UI for Omnitron. This private workspace application uses React, Vite and Prism, and communicates with Omnitron services through Netron.

## Capabilities

- Project, stack and application status and lifecycle controls.
- Logs, metrics, health and pipeline run inspection.
- Runtime catalogs, reviewed backend rollouts and reconciliation.
- Shared permission-aware actions and operational receipts.

## Workspace selection

The address identifies the workspace. Open `/` for the controller overview or `/projects/<project>` for a project. Choose a project in the header, then select **All stacks** or a stack. A filtered list has an address such as `/projects/sample/apps?stack=research`. Only an explicit workspace switch uses the last page visited in that workspace. Bookmarks, new tabs, reload, Back and Forward use the address of the selected history entry.

A local application's address is `/projects/<project>/apps/<stack>/<app>`. System Overview, Applications and the stack's runtime inventory link to the same card. The URL, header, sidebar and breadcrumbs use the public owner, including when an imported configuration retains a different runtime namespace. The card shows its exact controller handle. Read access to the card uses the daemon's `getApp` permission. Inventory, diagnostics, health and lifecycle controls use their respective permissions. A remote deployment links to its stack when the account can read it. A controller process without a known project opens at `/processes/<encoded-handle>`. A bare handle supports inspection of its exact process and has no lifecycle controls.

**Stacks** and **Applications** belong to projects. **Projects**, **Nodes**, **SSH workspace**, **Files**, **Traces**, **Alerts**, **Access**, **Audit**, **System** and **Settings** belong to the controller. Overview, Agent Studio, Dashboard Builder, Logs, Metrics, Pipelines, Releases, Deployments, Topology and Containers support both workspaces. The sidebar follows the current workspace and account permissions. Project release catalogs stay available across stack selections. The selected stack narrows deployment observations and the proposed deployment target.

**Pipelines** shows automations with a release or deployment step targeting the selected project or stack. A graph with several targets appears in each relevant workspace. **Runs** uses the targets and name saved when each request was prepared, including runs of a definition that has since moved. The **Omnitron** workspace also includes shell-only automations and older runs with no recorded targets. Older receipts with just a project name appear under **All stacks** for that project.

Open a failed or interrupted run to see which steps block continuation. **Inspect remote receipts** reads fresh deployment evidence where available. **Continue remaining steps** uses the reviewed checkpoint and any original parameters.

In the automation editor, each arrow points from a prerequisite to the step that waits for it.
Drag between ports to connect steps, or choose a step from **Add prerequisite** and press **Connect** using a keyboard or touch.
Double-click an arrow or use its removal button to disconnect it. Steps without prerequisites are eligible
to start together, subject to the runner’s concurrency limit. Renaming a step updates its references.
Removing a step removes its incident dependencies. **Advanced JSON** edits the same `dependsOn` arrays,
including forward references. Saving checks the revision you opened. To run the automation, open **Run** and review its targets.

A stack detail page uses `/projects/<project>/stacks/<stack>`. Selecting another stack opens its details. **All stacks** opens the inventory. Selecting a different stack from an application card opens the Applications list for the selection. A release detail uses `/projects/<project>/releases/<id>`. A link that only knows the release ID can use `/releases/<id>`. The controller's release record supplies the canonical project.

Logs lists the selected stack's local and remote applications, including those awaiting their first log. For an older worker that reports `project/deployed/app`, select its registry node and application. Console includes those records when the observed placement identifies one stack on that node.

In **Deploy a release**, an administrator can update missing application declarations for the selected release and target. Console then asks the controller for a fresh admission decision. A running target that needs to stop stays available through **Inspect stack** for a separate reviewed operation.

## Quick start

Install and build the workspace dependencies as described in the [root README](../../../README.md), then run from this directory:

```sh
pnpm dev
```

The development server listens on `http://localhost:9810`. Its configured proxies target the local Omnitron HTTP service on port 9801 and WebSocket service on port 9802. A working backend and an authorized session are required for management operations.

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm test:browser
```

`build` uses the Console publisher to validate a staged build before replacing `dist`. Browser tests use a private loopback fixture; install Playwright's Chromium first if it is unavailable, or set `PLAYWRIGHT_CHANNEL=chrome` to use an installed Chrome.

## Runtime operations

**Nodes → Managed backend updates** prepares a rollout from selected catalog builds or an exact commit. Review the node checks, owner and rollback artifacts before applying the plan. **Stage from controller catalog** explicitly transfers missing runtimes; leaving it unchecked inspects already staged artifacts.

A receipt link with `?rollout=…` opens the same operation after reload. If acknowledgement is lost, use **Reconcile node status** to inspect its outcome. Browser permissions do not replace the backend's authorization or lifecycle checks.

## Contributing

Use Prism and the shared theme for controls, visible focus and responsive layout. Preserve existing permission gates and confirmation flows. The shared `RowActions` component owns overflow-menu ordering; `usePolledResource.refresh` joins a fresh read after mutations. Reuse those mechanisms instead of adding page-specific polling or retry loops.

## Documentation

[Omnitron](../README.md) · [Scripts](package.json) · [Vite configuration](vite.config.ts) · [Source](src)

## License

[MIT](../../../LICENSE).
