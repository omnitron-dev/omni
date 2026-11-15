import React, { createContext, lazy, useContext, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { PrismProvider } from '@omnitron-dev/prism/core';
import { Button } from '@omnitron-dev/prism/ui';
import { LumenShell } from '@omnitron-dev/lumen-ui/runtime';

const Label = createContext('MISSING CONTEXT');
export function Layout({ children }: { children: ReactNode }) {
  return <PrismProvider mode="light" disableCssBaseline>
    <Label.Provider value="Requests">{children}</Label.Provider>
  </PrismProvider>;
}
export function Counter() {
  const label = useContext(Label);
  const [count, setCount] = useState(0);
  useEffect(() => { document.body.dataset.counterInteractive = 'true'; }, []);
  return <>
    <Button variant="contained" data-probe="counter" onClick={() => setCount(value => value + 1)}
      sx={{ width: 200, height: 64 }}>{label}: {count}</Button>
    <pre data-static-preview style={{ maxHeight: 80, overflow: 'auto', maxWidth: '100%' }}>
      {'Complete static preview. '.repeat(2000)}
    </pre>
    <details data-lumen-disclosure="source"><summary>Counter source</summary><pre>Shared counter source</pre></details>
    <details data-lumen-disclosure="metadata" open><summary>Counter metadata</summary><p>Shared context</p></details>
  </>;
}

declare global {
  interface Window {
    startIsland: () => void;
    finishIsland: () => void;
  }
}
if (typeof window !== 'undefined') {
  let ready!: (module: { default: typeof Counter }) => void;
  const pending = new Promise<{ default: typeof Counter }>(resolve => { ready = resolve; });
  const DeferredCounter = lazy(() => pending);
  window.startIsland = () => createRoot(document.getElementById('interactive-root')!).render(
    <Layout><LumenShell disablePrismProvider theme="light" islands={{ Counter: DeferredCounter }} /></Layout>,
  );
  window.finishIsland = () => ready({ default: Counter });
}
