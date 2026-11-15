import React, { useEffect, useState } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { PrismProvider, PrismThemeScript, usePrismContext } from '@omnitron-dev/prism/core';
import { Button } from '@omnitron-dev/prism/ui';
import { omnitronTheme } from '@omnitron-dev/prism/identity';
import { CodeBlock } from '@omnitron-dev/lumen-ui/blocks';

function Probe({ staticCode }: { staticCode: string }) {
  const { setMode } = usePrismContext();
  const [count, setCount] = useState(0);
  useEffect(() => { document.body.dataset.themeReady = 'true'; }, []);
  return <>
    <Button data-probe="palette" variant="contained" onClick={() => setCount(count + 1)}>Read the docs {count}</Button>
    <Button data-probe="mode" onClick={() => setMode('dark')}>Dark</Button>
    <Button data-probe="system" onClick={() => setMode('system')}>System</Button>
    <div data-probe="static-code" dangerouslySetInnerHTML={{ __html: staticCode }} />
    <CodeBlock code={'const answer = 42;\n'} language="typescript" />
  </>;
}

declare global {
  interface Window { hydrateThemeProbe(): void; }
}
window.hydrateThemeProbe = () => {
  const staticCode = document.querySelector('[data-probe="static-code"]')!.innerHTML;
  hydrateRoot(document.getElementById('theme-root')!,
    <PrismProvider modeStorageKey="prism-test-theme" themeOverrides={omnitronTheme}>
      <PrismThemeScript modeStorageKey="prism-test-theme" />
      <Probe staticCode={staticCode} />
    </PrismProvider>
  );
};
