import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PrismProvider } from '@omnitron-dev/prism/core';
import { Button } from '@omnitron-dev/prism/ui';
import { LumenSearchDialog, type NetronSearchClient } from '@omnitron-dev/lumen-ui';

const client: NetronSearchClient = { search: async query => {
  const response = await fetch(`/search-fixture?q=${encodeURIComponent(query)}`);
  if (!response.ok) throw new Error('Search service unavailable');
  return response.json();
} };

function SearchFixture() {
  const [open, setOpen] = useState(false);
  return <PrismProvider>
    <Button onClick={() => setOpen(true)}>Search documentation</Button>
    <LumenSearchDialog open={open} onClose={() => setOpen(false)} defaultTab="semantic" rpcClient={client} />
    <p id="guide">Documentation</p>
  </PrismProvider>;
}
createRoot(document.getElementById('root')!).render(<SearchFixture />);
