import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DocSectionNav } from '@omnitron-dev/lumen-ui/layout';
import { LumenShell } from '@omnitron-dev/lumen-ui/runtime';
import { PrismProvider } from '@omnitron-dev/prism/core';
import { ScrollSpyProvider, ScrollSpySection, DocSectionNav as PrismSectionNav } from '@omnitron-dev/prism/components/doc-layout';

function Nested() {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const content = useRef<HTMLDivElement>(null);
  return <PrismProvider><ScrollSpyProvider root={root} containerRef={content} headingSelector="">
    <div id="nested-nav"><PrismSectionNav headings={[
      { id: 'nested-first', text: 'Nested first', level: 2 },
      { id: 'nested-last', text: 'Nested last', level: 2 },
    ]} /></div>
    <div id="nested-root" ref={setRoot}><div ref={content}>
      <ScrollSpySection id="nested-first"><div style={{ height: 1000 }}><h2>Nested first</h2></div></ScrollSpySection>
      <ScrollSpySection id="nested-last"><div style={{ height: 80 }}><h2>Nested last</h2></div></ScrollSpySection>
    </div></div>
  </ScrollSpyProvider></PrismProvider>;
}
if (new URL(location.href).searchParams.has('nested')) {
  for (const selector of ['#toc', '#article', 'footer']) document.querySelector(selector)?.remove();
  createRoot(document.getElementById('root')!).render(<Nested />);
} else {
  createRoot(document.getElementById('root')!).render(<LumenShell islands={{ DocSectionNav }} />);
}
