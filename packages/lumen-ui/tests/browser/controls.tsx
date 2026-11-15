import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PrismProvider } from '@omnitron-dev/prism/core';
import { Box, Button } from '@omnitron-dev/prism/ui';
import { ApiExplorer, LumenNavbar, LumenSearchDialog, NetronPlayground, type NetronSearchClient, type PlaygroundServiceResult } from '@omnitron-dev/lumen-ui';

const symbols = Array.from({ length: 1000 }, (_, index) => ({ id: `symbol-${index}`, name: `Symbol ${index}` }));
const search: NetronSearchClient = { search: async (query: string) => [{ documentId: 'guide', title: `Guide for ${query}`, path: '#guide', snippet: 'Read the <mark>guide</mark>.', score: 1 }] };

function Controls() {
  const [mode, setMode] = useState<'light' | 'dark'>('light');
  const [version, setVersion] = useState('v1');
  const [locale, setLocale] = useState('en');
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState('');
  const [complete, setComplete] = useState<(() => void) | null>(null);
  return <PrismProvider mode={mode}>
    <Box sx={{ p: 2 }}>
      <LumenNavbar title="Lumen" items={[{ label: 'Docs', items: [
        { label: 'Guide', href: '#guide' }, { label: 'Reference', items: [{ label: 'API', href: '#api' }] },
      ] }]}
        versions={['v1', 'v2']} currentVersion={version} onVersionChange={setVersion}
        locales={['en', 'de']} currentLocale={locale} onLocaleChange={setLocale}
        theme={mode} onThemeToggle={() => setMode(value => value === 'light' ? 'dark' : 'light')}
        onSearchClick={() => setOpen(true)} />
      <output aria-label="Selected edition">{version} / {locale}</output>
      <LumenSearchDialog open={open} onClose={() => setOpen(false)} rpcClient={search} />
      <h1 id="guide">Guide</h1>
      <section id="api" aria-label="API reference">
        <ApiExplorer symbols={symbols} maxListHeight={144} onSelectSymbol={value => setSelection(typeof value === 'string' ? value : value.name)} />
        <output aria-label="Selected symbol">{selection}</output>
      </section>
      <NetronPlayground code="return 42" snapshot={{ code: 'return 42', result: 42 }} execute={code => new Promise<PlaygroundServiceResult>(resolve => {
        setComplete(() => () => { resolve({ code, result: 42 }); setComplete(null); });
      })} />
      {complete && <Button onClick={complete}>Complete execution</Button>}
    </Box>
  </PrismProvider>;
}
createRoot(document.getElementById('root')!).render(<Controls />);
