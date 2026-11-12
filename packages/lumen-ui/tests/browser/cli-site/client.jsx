import React, { lazy, Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CodeBlock, LumenShell, MermaidDiagram } from '@omnitron-dev/lumen-ui';

const LazyApi = lazy(() => import('./lazy-api.jsx'));

function Client() {
  const [open, setOpen] = useState(false);
  return <LumenShell theme="light" islands={{ MermaidDiagram }}>
    <button onClick={() => setOpen(true)}>Open API explorer</button>
    <CodeBlock className="client-code" code="const value = 'A deliberately long client code line with native keyboard scrolling';" />
    {open && <Suspense fallback={<p>Loading API explorer</p>}><LazyApi /></Suspense>}
  </LumenShell>;
}

const host = document.createElement('div');
document.body.append(host);
createRoot(host).render(<Client />);
