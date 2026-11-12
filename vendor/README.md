# Vendored inputs

No third-party package source is currently stored in this directory. Runtime dependencies are resolved through package manifests and [pnpm-lock.yaml](../pnpm-lock.yaml); workspace-wide overrides and dependency patches are declared in [pnpm-workspace.yaml](../pnpm-workspace.yaml).

Use the normal dependency and package-consumer checks when changing those inputs. A local source checkout or copied `dist` directory is not a substitute for a declared registry dependency.
