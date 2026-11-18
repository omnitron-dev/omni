import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DocSidebar } from '@omnitron-dev/prism/components/doc-layout';
import { LumenShell } from '@omnitron-dev/lumen-ui/runtime';

function Navigation(props: React.ComponentProps<typeof DocSidebar>) {
  const [activeId, setActive] = useState(props.activeId);
  const [items, setItems] = useState(props.items);
  useEffect(() => {
    const activate = (event: Event) => setActive((event as CustomEvent<string>).detail);
    const refresh = () => setItems(previous => [...previous]);
    document.addEventListener('select-document', activate);
    document.addEventListener('refresh-navigation', refresh);
    document.documentElement.dataset.interactive = 'true';
    return () => {
      document.removeEventListener('select-document', activate);
      document.removeEventListener('refresh-navigation', refresh);
    };
  }, []);
  return <DocSidebar {...props} activeId={activeId} items={items} />;
}

createRoot(document.getElementById('root')!).render(<LumenShell theme="light" islands={{ DocSidebar: Navigation }} />);
