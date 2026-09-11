import { defineEcosystem } from '@omnitron-dev/omnitron';

/**
 * The config a daemon started from this directory boots with.
 *
 * It declares no apps on purpose. This package is the control plane: the
 * processes it runs belong to registered projects and arrive through
 * `omnitron stack start <project> <stack>`, each stamped with its own project
 * root.
 *
 * What was here before was a copy of the `omnitron init` scaffold — five apps
 * named `main`, `storage`, `pricing`, `payments` and `messaging`, pointing at
 * `./apps/<name>/src/main.ts` relative to THIS directory, where none of them
 * exist. The daemon registered all five at every boot, wrote an error apiece
 * about a watch directory it could not resolve, and put five bare names into
 * the same namespace as the downstream stack's five identically-named apps. That
 * collision is what made `omnitron restart acme/dev/payments` launch omnitron's
 * sample entry instead (see test/unit/restart-keeps-the-project-prefix.test.ts
 * — the resolver refuses to cross projects now, and this removes the thing it
 * was refusing).
 */
export default defineEcosystem({
  apps: [],

  supervision: {
    strategy: 'one_for_one',
    maxRestarts: 5,
    window: 60_000,
    backoff: { type: 'exponential', initial: 1_000, max: 30_000, factor: 2 },
  },

  monitoring: {
    healthCheck: { interval: 15_000, timeout: 5_000 },
    metrics: { interval: 5_000, retention: 3600 },
  },

  logging: {
    directory: '~/.omnitron/logs/',
    maxSize: '50mb',
    maxFiles: 10,
    compress: true,
  },

  daemon: {
    port: 9700,
    host: '127.0.0.1',
    pidFile: '~/.omnitron/daemon.pid',
    stateFile: '~/.omnitron/state.json',
  },

  env: 'development',
});
