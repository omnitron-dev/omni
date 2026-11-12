import React from 'react';
import { createRoot } from 'react-dom/client';
import { LumenShell, ApiExplorer, NetronPlayground, MermaidDiagram, DocSectionNav } from '@omnitron-dev/lumen-ui';

const host = document.createElement('div');
host.id = 'lumen-client';
document.body.append(host);
createRoot(host).render(
  React.createElement(LumenShell, {
    theme: document.body.dataset['theme'] ?? 'dark',
    currentPath: location.pathname,
    islands: { MermaidDiagram, ApiExplorer, NetronPlayground, Playground: NetronPlayground, DocSectionNav },
  })
);
