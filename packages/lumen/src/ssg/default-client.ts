import React, { lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { LumenShell } from '@omnitron-dev/lumen-ui/runtime';

const ApiExplorer = lazy(() =>
  import('@omnitron-dev/lumen-ui').then(({ ApiExplorer }) => ({ default: ApiExplorer })));
const NetronPlayground = lazy(() =>
  import('@omnitron-dev/lumen-ui').then(({ NetronPlayground }) => ({ default: NetronPlayground })));
const MermaidDiagram = lazy(() =>
  import('@omnitron-dev/lumen-ui').then(({ MermaidDiagram }) => ({ default: MermaidDiagram })));
const DocSectionNav = lazy(() =>
  import('@omnitron-dev/lumen-ui/layout').then(({ DocSectionNav }) => ({ default: DocSectionNav })));

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
