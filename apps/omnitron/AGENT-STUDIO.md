# Agent Studio

Agent Studio connects a Console operator to a model available through their local Codex or Antigravity subscription. Use it to choose a starter, discuss an existing project or review a proposed change. The operator can inspect each result and record an acceptance decision.

## Plan a first project

1. Open **Workspace → Agent Studio** with an operator or administrator account. In the system workspace, the conversation belongs to project planning.
2. Pick a provider. Run the connection command shown in the Console in a terminal on the daemon host, as the account that owns the subscription. Leave the terminal open while using the adapter.
3. Select a model, choose **Plan a project** and describe a concrete job. Include what triggers the work, what must survive between runs and whether a process must remain available.
4. Once the requirements are clear, review the proposed choices. **Review project starter** opens the project form with those choices. Adjust any of them, set the name and inspect the full file contents, effects, dependencies and destination.
5. An administrator can confirm **Create project** against the reviewed digest. The server checks the review again, creates the files under its workspace and registers the project. The same form works directly from **Projects**.

| Example requirement | Minimal composition | What the starter runs |
| --- | --- | --- |
| Check a group of scripts on demand | Xec | A repeatable local task |
| Record observations in an embedded database and inspect them later | Kysera with SQLite | A standalone data command |
| Run a repeatable task and retain its result | Xec and Kysera with the selected driver | The task runs the data command |
| Keep one process available under supervision | Node worker | A process in the project's `dev` stack |
| Run a Titan application, automate checks and persist observations | Titan, Xec and Kysera | A supervised application and two independently invocable commands |

SQL projects select one driver for SQLite, PostgreSQL or MySQL. Xec and Kysera command projects have no resident worker. On the command line, `omnitron init --name weekly-report --automation --database sqlite --service none` produces the same reviewed composition. The generated README describes installation and the commands, including which operation creates a table or writes an event.

## Work on an existing project

Choose a registered project in the Console. Select a stack to bind a new conversation to it. Open **Connection details** and run the copied command from that project's registered directory. Each connection serves one provider, Console account and workspace. For example:

```sh
omnitron studio connect reports --account ACCOUNT_ID --provider agy
```

Before the first project exists, use `omnitron studio connect --planning --account ACCOUNT_ID --provider codex`. If several CLI installations exist, select the executable with `--binary /absolute/path/to/codex`. Model discovery uses `codex debug models` or `agy models` from that executable.

Use **Attach text** to read a small UTF-8 file into the editable message. Inspect or remove any part before sending. The message limit is 32 KiB. The adapter starts the provider in a private temporary working directory and passes the selected model, role instructions, explicit message and provider conversation identifier. The provider handles its own authentication and can identify its subscriber. The local Console account ID, registered project path and filename stay in Omnitron unless included in the message itself.

## Assign and review work

| Responsibility | Expected result |
| --- | --- |
| Analyst | Findings, uncertainties and a proposal |
| Engineer | Proposed implementation and validation |
| Reviewer | Findings with evidence |
| Operator | An operational runbook with checks and recovery |

Select a model explicitly or use **Automatic · budgeted** with a maximum cost tier. The connector reads the models its installed CLI actually offers. For automatic routing, use `--model-policy /path/to/policy.json` to declare the task classes and cost limits you have qualified for those models. This sample uses an illustrative ID that must be replaced with a listed ID.

```json
[
  {
    "id": "your-listed-model-id",
    "classes": ["general", "reasoning"],
    "costTier": "economy",
    "qualityTier": "standard"
  }
]
```

Models with unknown costs stay available for explicit selection. Automatic routing filters by task requirements, then orders eligible models by comparable quotes or approved cost tiers. Model families and display names carry no implicit cost or ability. The thread records the selection. A change of model or a cost increase requires a fresh decision. Each completed turn displays the input and output token counts supplied by the provider. A missing count is shown as a dash.

The local ledger retains the request, response, outcome, reported usage and operator review. An operator can choose **Accept result** or **Request changes** and record the reasoning. Project creation, applying changes and deploying processes use the authority and review rules of their owning Omnitron operation.

## Recover an interrupted conversation

The daemon admits each turn by a stable request ID and rechecks the sending user's session before dispatch. A connector claims one turn at a time. **Stop turn** cancels queued or running work. Losing the connector marks in-flight work interrupted and preserves the last recorded response. After a lost acknowledgment, inspect the conversation or retry the same request. Start a fresh conversation for an interrupted turn whose provider outcome is unknown.

## Verification

The integration tests exercise the private Netron socket, SQLite ledger, local Xec executor and installed provider under a synthetic account. The optional subscription test uses three synthetic turns per configured provider to check conversation continuity and project composition. Select an executable with `OMNITRON_STUDIO_LIVE_CODEX` or `OMNITRON_STUDIO_LIVE_AGY`, and a listed model with the corresponding `OMNITRON_STUDIO_MODEL_CODEX` or `OMNITRON_STUDIO_MODEL_AGY`. From the Omnitron application package run `pnpm exec vitest run test/integration/studio-subscription.test.ts`.
