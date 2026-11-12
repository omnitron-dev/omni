import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
// Exercise the published entry and emitted worker, not a substitute source evaluator.
import { NetronPlayground, type PlaygroundExecutionResult } from '../../dist/index.js';

declare global {
  interface Window { playgroundAudit: { results: PlaygroundExecutionResult[]; created: number; terminated: number } }
}
window.playgroundAudit = { results: [], created: 0, terminated: 0 };
const NativeWorker = window.Worker;
window.Worker = class extends NativeWorker {
  constructor(url: string | URL, options?: WorkerOptions) { super(url, options); window.playgroundAudit.created++; }
  terminate() { window.playgroundAudit.terminated++; super.terminate(); }
};
const params = new URLSearchParams(location.search);
function Fixture() {
  const [count, setCount] = useState(0);
  const code = 'return 6 * 7';
  return <>
    <button onClick={() => setCount(value => value + 1)}>Host counter {count}</button>
    <NetronPlayground code={code} timeoutMs={params.has('timeout') ? Number(params.get('timeout')) : undefined}
      snapshot={{ code, result: 'previous output' }} mode={params.has('server') ? 'server' : 'local'}
      execute={params.has('server') ? async () => { throw new Error('Permission denied'); } : undefined}
      onExecute={result => window.playgroundAudit.results.push(result)} />
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
