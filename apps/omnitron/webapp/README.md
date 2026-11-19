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

**Stacks** and **Applications** belong to projects. **Projects**, **Nodes**, **SSH workspace**, **Files**, **Traces**, **Alerts**, **Access**, **Audit**, **System** and **Settings** belong to the controller. Overview, Agent Studio, Dashboard Builder, Flows, Logs, Metrics, Pipelines, Releases, Deployments, Topology and Containers support both workspaces. The sidebar follows the current workspace and account permissions. Project release catalogs stay available across stack selections. The selected stack narrows deployment observations and the proposed deployment target.

**Pipelines** shows automations with a release or deployment step targeting the selected project or stack. A graph with several targets appears in each relevant workspace. **Runs** uses the targets and name saved when each request was prepared, including runs of a definition that has since moved. The **Omnitron** workspace also includes shell-only automations and older runs with no recorded targets. Older receipts with just a project name appear under **All stacks** for that project.

Open a failed or interrupted run to see which steps block continuation. **Inspect remote receipts** reads fresh deployment evidence where available. **Continue remaining steps** uses the reviewed checkpoint and any original parameters.

In the automation editor, each arrow points from a prerequisite to the step that waits for it.
Drag between ports to connect steps, or choose a step from **Add prerequisite** and press **Connect** using a keyboard or touch.
Double-click an arrow or use its removal button to disconnect it. Steps without prerequisites are eligible
to start together, subject to the runner’s concurrency limit. Renaming a step updates its references.
Removing a step removes its incident dependencies. **Advanced JSON** edits the same `dependsOn` arrays,
including forward references. Saving checks the revision you opened. To run the automation, open **Run** and review its targets.

A stack detail page uses `/projects/<project>/stacks/<stack>`. Selecting another stack opens its details. **All stacks** opens the inventory. Selecting a different stack from an application card opens the Applications list for the selection. A release detail uses `/projects/<project>/releases/<id>`. A link that only knows the release ID can use `/releases/<id>`. The controller's release record supplies the canonical project.

Logs lists the selected stack's local and remote applications, including those awaiting their first log. For an older worker that reports `project/deployed/app`, select its registry node and application. Console includes those records when the observed placement identifies one stack on that node. The Topology log drawer and its **View logs** link use the same application handle and registry node. An ambiguous placement is shown as unconfirmed.

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

## Agent Studio

Open **Agent Studio** in the desired project and stack, or use the controller workspace for planning. A team address such as `/projects/sample/studio?stack=dev&team=<id>` opens that team's journal for the owning Console account. A room with a stack opens in its recorded stack. **Earlier messages** and browser Back restore the selected history page.

To start a team, enter its name and choose the lead's name, responsibility, connected adapter and model. A lead needs a connector with Studio team tools. **Team limits** sets the allowed adapters, member and delegation limits, and cost tier. Creating the team leaves the journal empty. **Members** shows each person's role, adapter and selected model. Operators with the corresponding access can invite or retire participants and change limits.

Choose the recipient in **Chat**. **Tasks** addresses work to a specific member and keeps its queued, running or final receipt. The journal shows who initiated each turn and who received it. Other members can receive messages while a task is active. Messages, attached text and shared memory may enter the assigned providers' context. A lost acknowledgement can be retried with the original request ID or withdrawn.

The **Tasks** tab loads the team's task bodies when opened, and `tab=tasks` in the room address returns to that view. The journal follows work in progress across all team members. **Memory** stores named, revisioned notes. **Flows** lists the team's proposals. **Open in flow editor** carries the team, proposal and current workspace to the editor for review. Existing individual conversations remain accessible. With a compatible lead connector, **Enable team** adds team collaboration to an individual conversation.

## Runtime operations

**Nodes → Managed backend updates** prepares a rollout from selected catalog builds or an exact commit. Review the node checks, owner and rollback artifacts before applying the plan. **Stage from controller catalog** explicitly transfers missing runtimes; leaving it unchecked inspects already staged artifacts.

A receipt link with `?rollout=…` opens the same operation after reload. If acknowledgement is lost, use **Reconcile node status** to inspect its outcome. Browser permissions do not replace the backend's authorization or lifecycle checks.

## Contributing

Use Prism and the shared theme for controls, visible focus and responsive layout. Preserve existing permission gates and confirmation flows. The shared `RowActions` component owns overflow-menu ordering; `usePolledResource.refresh` joins a fresh read after mutations. Reuse those mechanisms instead of adding page-specific polling or retry loops.

## Documentation

[Omnitron](../README.md) · [Scripts](package.json) · [Vite configuration](vite.config.ts) · [Source](src)

## License

[MIT](../../../LICENSE).

## Flows

**Flows** opens the controller inventory at `/flows` or a project inventory at `/projects/<project>/flows`. A project's **All stacks** inventory includes its stack flows. The inventory shows 25 summaries per page. **Older flows** and **Latest flows** preserve the selected workspace in the URL. Opening a flow reads and refreshes its own graph and its recent events. Each saved link opens its owning stack with `?flow=<id>&stack=<stack>`. **Pipelines** links to Flows in the same workspace.

Start with **New flow** or the **Disk space template**. Select a component from the controller's node library, add it, and configure its fields in the inspector. Drag a named output onto an input, or choose **Output port** and **Target node** and press **Connect nodes**. The editor lays out the saved graph by its connections when opened. Dragging a node moves it for the current view. Selecting **Inspect node** also works from the keyboard. The inspector lists each connection and can disconnect it or rename a node and its connected edges.

For a remote disk, select **Disk space on enrolled node** from the library, or change **Disk location** to **Enrolled node** in the disk space template. Choose the registered peer and its exact **Mounted filesystem**. The selector reads the chosen peer through the same inventory as **System → Storage**. An unavailable peer, a stale disk reading or an ambiguous mount is identified in the inspector. Changing peers clears the mount. Remote sampling intervals start at five seconds. The controller records the resulting events and delivers the reviewed outputs.

**Preview event** evaluates sample fields through the controller's installed components. Highlighted branches show exactly where the sample went. Each expected output shows its configuration and event data. **Use previous preview state** tests stateful behavior such as a disk warning followed by recovery.

**Save draft** writes a revision to the selected workspace. **Review activation** identifies the sources and outputs it will enable. An active revision keeps running when a newer draft is saved. A separate confirmation can send a previewed manual or incoming event to the active revision. **Recent events** contains the actual path, state, delivery statuses and native result IDs. An eligible delivery can be retried by its original account after review. **Review pause** stops the current activation. New local notifications appear on any open page in the current workspace and link back to their flow.

Resending the same event ID and data returns its existing receipt. A disk source samples the current reading at its recorded deadline. Transient threshold crossings or stack broadcasts can go unobserved during downtime. A delivery dispatched before a pause can still receive its acknowledgement. Inspect the native command ID for an unconfirmed result.

Studio's **Open in flow editor** opens the proposed graph with `?team=<id>&proposal=<id>` and the team's recorded stack. The team's readers can inspect the proposed graph and its fields. With catalog and preview access they can edit and simulate a local draft. Saving, activation and event delivery each require their corresponding permission.
