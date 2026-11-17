import React, { lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { LumenShell } from '@omnitron-dev/lumen-ui/runtime';

const ApiExplorer = lazy(() =>
  import('@omnitron-dev/lumen-ui').then(({ ApiExplorer: component }) => ({ default: component })));
const NetronPlayground = lazy(() =>
  import('@omnitron-dev/lumen-ui').then(({ NetronPlayground: component }) => ({ default: component })));
const MermaidDiagram = lazy(() =>
  import('@omnitron-dev/lumen-ui').then(({ MermaidDiagram: component }) => ({ default: component })));
const DocSectionNav = lazy(() =>
  import('@omnitron-dev/lumen-ui/layout').then(({ DocSectionNav: component }) => ({ default: component })));

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
