import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import type { SelectedRelease } from '../shared/dto/project.js';
import { assertReleaseId } from '../release/load.js';
import { stackExecutionKey, type StackExecutionScope } from '../shared/dto/stack-execution.js';

interface Selection { revision: number; release: SelectedRelease | null }
type SelectionStore = Pick<DaemonStateStore, 'kvGetSync' | 'kvUpdateSync'>;

function validate(stored: Selection | null): Selection {
  if (stored === null) return { revision: 0, release: null };
  if (!Number.isSafeInteger(stored.revision) || stored.revision < 1 ||
      (stored.release !== null && (!stored.release || typeof stored.release.id !== 'string' ||
        !/^[a-f0-9]{64}$/.test(stored.release.manifestSha256)))) throw new Error('Invalid local release selection');
  if (stored.release) assertReleaseId(stored.release.id);
  return stored;
}

/** Desired launch code belongs to a registration lifetime; a reused project name must never inherit it. */
export class LocalReleaseSelection {
  private readonly key: string;
  constructor(private readonly store: SelectionStore, scope: StackExecutionScope, registration: string) {
    if (!registration) throw new Error('Local release selection requires a project registration');
    this.key = 'lifecycle:local-release:' + stackExecutionKey(scope) + ':' + registration;
  }

  read(): Selection {
    return validate(this.store.kvGetSync<Selection>(this.key, { strict: true }));
  }

  select(expected: number, release: SelectedRelease | null): Selection {
    return this.store.kvUpdateSync<Selection>(this.key, stored => {
      const current = validate(stored);
      if (current.revision !== expected) throw new Error('Local release selection changed; inspect the stack and retry');
      return validate({ revision: expected + 1, release });
    });
  }
}
