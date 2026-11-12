# @omnitron-dev/lumen

Static site generator, Vite/Rolldown plugin, Corpus Graph verification engine, and CLI suite for Omnitron Lumen.

## Audience-specific static builds

`buildStaticSite(corpus, config, { roles, accessFilter })` uses the same
`DocumentAccessOptions` policy as Titan-Lumen. By default the audience is
anonymous. Custom grants propagate to page rendering, search, Markdown mirrors,
`llms.txt` and `llms-full.txt`; these targets never parse access rules separately.
Documents with invalid metadata are omitted rather than partially published.
Static artifacts are public to everyone who can download them, so privileged
builds must be hosted behind the corresponding access boundary.

See `audit/LUMEN-0.4.0.md` for the independent qualification ledger. The 0.4.0
release remains under audit; sandboxing, persistence, client hydration and output
publication require separate acceptance.

## Build output and recovery

`lumen build` stages a complete generation with a byte-count and SHA-256 inventory.
On a local filesystem, macOS and Linux publications persist and sync a small
journal before moving the prior output. A later build or serve verifies the
journal, native process birth and boot identity, and every generation file before
recovering an interrupted replacement. It refuses a live publisher, unknown
ownership and symlinks. Publication currently requires these native platform
probes; it does not infer a dead writer from an unverifiable PID.
Windows publication is unsupported until its native process identity probe is
implemented and qualified.

This is recoverable directory replacement, not a zero-gap atomic exchange.
Do not serve the mutable output directory directly while publishing to it.
`lumen serve` verifies and captures one generation with hardlinks, then previews
that snapshot through Vite until shutdown. Restart the preview to inspect a new
build. The publisher always writes fresh files in a new stage and never mutates
a captured generation in place. This protocol coordinates one host, not writers
sharing a network filesystem.
