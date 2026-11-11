# Repository workflow

- Develop directly on `main` in the primary checkout at `/Users/taaliman/projects/luxquant/omnitron-dev/omni`. The user must be able to inspect committed and in-progress changes there throughout the work.
- Do not start implementation in another branch or worktree unless the user explicitly requests it. Separate checkouts may be used to verify immutable source snapshots; they are not the source of ongoing development.
- Commit coherent, verified changes regularly. The user performs remote pushes and npm publication unless explicitly instructed otherwise.
- Use the mounted `/Volumes/AGI-Dev` volume for large builds, qualification checkouts, artifacts and caches. Project work belongs under `/Volumes/AGI-Dev/work/omnitron`; mount/cache instructions are in `/Volumes/AGI/dev/README.md`.
- Preserve running applications, Atlas and their history. Source development does not authorize runtime activation or service interruption; prepare a concrete transition and rollback plan before requesting a required pause.
- Reuse Netron for communication and authorization, Titan for application lifecycle and DI, and Prism for shared UI. Xec orchestrates repository/release workflows; Turbo supplies the package dependency graph and build cache.
- The platform is in active development: remove superseded implementations, forwarding files, compatibility aliases and their callers during refactoring. Do not preserve obsolete paths or duplicate layers for backwards compatibility. Update imports, exports, tests and documentation to the canonical API together.
