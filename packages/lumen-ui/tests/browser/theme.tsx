import React, { useEffect, useState } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { PrismProvider, PrismThemeScript, usePrismContext } from '@omnitron-dev/prism/core';
import { Button } from '@omnitron-dev/prism/ui';
import { omnitronTheme } from '@omnitron-dev/prism/identity';

function Probe() {
  const { setMode } = usePrismContext();
  const [count, setCount] = useState(0);
  useEffect(() => { document.body.dataset.themeReady = 'true'; }, []);
  return <>
    <Button data-probe="palette" variant="contained" onClick={() => setCount(count + 1)}>Read the docs {count}</Button>
    <Button data-probe="mode" onClick={() => setMode('dark')}>Dark</Button>
    <Button data-probe="system" onClick={() => setMode('system')}>System</Button>
  </>;
}

declare global {
  interface Window { hydrateThemeProbe(): void; }
}
window.hydrateThemeProbe = () => {
  hydrateRoot(document.getElementById('theme-root')!,
    <PrismProvider modeStorageKey="prism-test-theme" themeOverrides={omnitronTheme}>
      <PrismThemeScript modeStorageKey="prism-test-theme" />
      <Probe />
    </PrismProvider>
  );
};
