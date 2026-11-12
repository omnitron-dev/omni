import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LumenShell } from '@omnitron-dev/lumen-ui/runtime';

function Counter({ label, left, right }: { label: string; left?: { value: string }; right?: { value: string } }) {
  const [count, setCount] = useState(0);
  return <><button onClick={() => setCount(value => value + 1)}>{label} {count}</button>
    {left && right && <output>{left.value} / {right.value}</output>}</>;
}
function Page() {
  const [count, setCount] = useState(0);
  return <LumenShell disablePrismProvider islands={{ Counter }}>
    <button onClick={() => setCount(value => value + 1)}>Page counter {count}</button>
  </LumenShell>;
}
createRoot(document.getElementById('root')!).render(<Page />);
