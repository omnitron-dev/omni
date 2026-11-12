import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { renderDiagramHtml } from '@omnitron-dev/lumen-ast/diagrams';
import { LumenShell, MermaidDiagram } from '@omnitron-dev/lumen-ui';

const examples: Record<string, string> = {
  flow: '---\nconfig:\n  layout: elk\n---\nflowchart LR\nsubgraph Input\nA[Parser] --> B{Valid?}\nend\nB -->|yes| C[Commit]\nB -.->|no| D[Reject]',
  sequence: 'sequenceDiagram\nparticipant Client\nparticipant Server\nalt authenticated\nClient->>Server: Save\nloop retry\nServer-->>Client: Retry\nend\nelse denied\nServer-->>Client: Denied\nend\nNote over Client,Server: Complete contract',
  classes: 'classDiagram\nclass Document {\n+String title\n+save() Boolean\n}\nclass Revision\nDocument "1" --> "many" Revision : history',
  states: 'stateDiagram-v2\n[*] --> Pending\nPending --> Running: accepted\nRunning --> Finished: complete\nRunning --> Failed: error\nFinished --> [*]',
  invalid: 'flowchart LR\nA[Unclosed',
  entities: 'flowchart TB\nsubgraph Infra["Infrastructure (Docker / bare-metal)"]\nA["A #quot;quoted#quot; contract"] --> B["x #60; y #38; y #62; 0"]\nend',
  unsafe: '%%{init: {"securityLevel":"loose","htmlLabels":false,"themeCSS":"body{opacity:0}","dompurifyConfig":{"ALLOWED_TAGS":["img","script","style","a"],"ALLOWED_ATTR":["src","onerror","href"]}}}%%\nflowchart TD\nA["<img src=/canary onerror=alert(1)>Test"] --> B[Safe]\nB --> C["#60;img src=/canary onerror=alert(2)#62;Encoded"]\nC --> D["<a href=javascript:alert(3)>Link</a><style>body{opacity:0}</style><script>alert(4)</script>"]\nclick B "javascript:alert(1)"',
  edges: '%%{init: {"maxEdges":100000}}%%\nflowchart TD\n' + Array.from({ length: 501 }, (_, index) => `N${index}-->N${index + 1}`).join('\n'),
};
const selected = new URLSearchParams(location.search).get('example') ?? 'flow';
document.getElementById('islands')!.innerHTML = renderDiagramHtml(examples[selected] ?? examples.flow!, 0, 'acceptance');
function Fixture() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  return <LumenShell theme={theme} islands={{ MermaidDiagram }}>
    <button onClick={() => setTheme(value => value === 'light' ? 'dark' : 'light')}>Change theme</button>
    <button onClick={() => { document.getElementById('islands')!.innerHTML = renderDiagramHtml(examples.flow!, 1, 'recovered'); }}>Valid diagram</button>
  </LumenShell>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
