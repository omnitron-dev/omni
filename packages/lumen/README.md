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
