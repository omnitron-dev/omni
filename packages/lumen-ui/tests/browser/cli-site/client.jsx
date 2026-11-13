import React, { lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CodeBlock, LumenShell, MermaidDiagram } from '@omnitron-dev/lumen-ui';
import { ComponentExample } from '@omnitron-dev/lumen-ui/blocks';
import CounterExample from './counter-example.js';
import counterSource from './counter-example.js?raw';

const LazyApi = lazy(() => import('./lazy-api.jsx'));
const SourceModule = lazy(() => import('./source-example.jsx'));
function SourceExample() {
  const [active, setActive] = useState(false);
  return active ? <Suspense fallback={<span role="status">Loading observation</span>}><SourceModule /></Suspense>
    : <button type="button" onClick={() => setActive(true)}>Load observation</button>;
}

function CounterDemo() {
  return <ComponentExample title="Counter example" code={counterSource} language="js" resettable>
    <CounterExample />
  </ComponentExample>;
}

function FailurePreview({ ready }) {
  if (!ready) throw new Error('Preview data is unavailable');
  return <span>Data restored</span>;
}

function HydrationCanary({ origin = 'diagram-label' }) {
  useEffect(() => {
    window.labelActivations ??= [];
    window.labelActivations.push(origin);
  }, [origin]);
  return <span data-canary-origin={origin}>Activated {origin}</span>;
}

function Client() {
  const [open, setOpen] = useState(false);
  return <LumenShell theme="light" islands={{ MermaidDiagram, HydrationCanary, CounterDemo, FailurePreview, SourceExample }}>
    <button onClick={() => setOpen(true)}>Open API explorer</button>
    <CodeBlock className="client-code" code="const value = 'A deliberately long client code line with native keyboard scrolling';" />
    {open && <Suspense fallback={<p>Loading API explorer</p>}><LazyApi /></Suspense>}
  </LumenShell>;
}

const host = document.createElement('div');
document.body.append(host);
createRoot(host).render(<Client />);
