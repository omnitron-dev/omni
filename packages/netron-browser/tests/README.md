# Browser-client tests

The package separates client unit tests, Node-to-Titan integration, and real-browser tests. Run the commands below from the repository root after installing workspace dependencies.

| Suite | Command | Runner |
| --- | --- | --- |
| Unit | `pnpm --filter @omnitron-dev/netron-browser test:unit` | [Vitest, happy-dom](../vitest.config.ts) |
| Integration | `pnpm --filter @omnitron-dev/netron-browser test:integration` | [Vitest, Node](../vitest.integration.config.ts) |
| Browser | `pnpm --filter @omnitron-dev/netron-browser test:e2e` | [Playwright](../playwright.config.ts) |

Integration and browser fixtures use the built Titan package. Build the dependency graph through the repository's normal Turbo workflow before executing them:

```sh
pnpm exec turbo run build --filter=@omnitron-dev/netron-browser...
```

For a Chromium-only browser run:

```sh
pnpm --filter @omnitron-dev/netron-browser exec playwright install chromium
pnpm --filter @omnitron-dev/netron-browser test:e2e --project=chromium
```

[Playwright's configuration](../playwright.config.ts) starts the fixture server through `test:e2e:serve` and uses port 3000 by default. Ensure that endpoint belongs to this fixture before running; local configuration permits reusing an existing server.

[Test services](fixtures/test-services.ts) and [the Titan server fixture](fixtures/titan-server.ts) define the exercised RPC surface. Await fixture cleanup so sockets, peers, and listeners close. See the [integration guide](integration/README.md) for focused cases; assertions and runner output are the current test inventory.
