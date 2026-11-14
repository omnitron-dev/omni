import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PrismProvider } from '@omnitron-dev/prism/core';
import { Box, Button, Stack, Typography } from '@omnitron-dev/prism/ui';
import { CodeBlock, ComponentExample } from '@omnitron-dev/lumen-ui/blocks';

const source = '// [!code highlight]\r\nconst greeting = "Привет 🌐";\r\nconst sample = <button aria-label="' + 'Long sample '.repeat(30) + '">Run</button>;\r\n// @errors: 1234\r\n// ^?\r\n';
function Counter() {
  const [count, setCount] = useState(0);
  const [crashed, setCrashed] = useState(false);
  if (crashed) throw new Error('Example request failed');
  return <Stack spacing={1}>
    <Typography>Requests processed by the example.</Typography>
    <Button onClick={() => setCount(value => value + 1)}>Count {count}</Button>
    <Button onClick={() => setCrashed(true)}>Fail example</Button>
  </Stack>;
}
function Fixture() {
  const [mode, setMode] = useState<'light' | 'dark'>('light');
  const [json, setJson] = useState(false);
  return <PrismProvider mode={mode}><Box sx={{ p: 2, maxWidth: 900, mx: 'auto' }}>
    <Button onClick={() => setMode(value => value === 'light' ? 'dark' : 'light')}>Change theme</Button>
    <ComponentExample title="Request counter" code={source} language="tsx" resettable>
      <Counter />
    </ComponentExample>
    <Button onClick={() => setJson(value => !value)}>Toggle JSON</Button>
    {json && <CodeBlock code={'{"enabled":true}\n'} language="json" copyable />}
  </Box></PrismProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
