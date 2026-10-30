import type { ChildProcess } from 'node:child_process';

// Installed only inside the guardian process. A shell environment cannot turn
// an independently launched CLI into the OS-owned parent of a backend.
let observer: ((child: ChildProcess) => void) | null = null;
export function ownBackendChildren(onChild: (child: ChildProcess) => void): () => void {
  if (observer) throw new Error('Backend child ownership is already configured');
  observer = onChild;
  return () => { if (observer === onChild) observer = null; };
}
export function supervisesBackendChildren(): boolean { return observer !== null; }
export function observeBackendChild(child: ChildProcess): void { observer?.(child); }
