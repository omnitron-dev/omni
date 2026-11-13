import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Tabs } from '@omnitron-dev/prism/components/tabs';

interface DocumentPanel {
  section: HTMLElement;
  heading: HTMLElement;
  value: string;
}

interface TabPreference { key: string; value: string }
const syncEvent = 'lumen:document-tab-change';

function fragmentTarget(doc: Document): HTMLElement | null {
  const hash = doc.defaultView?.location.hash;
  if (!hash) return null;
  try { return doc.getElementById(decodeURIComponent(hash.slice(1))); } catch { return null; }
}

/** Enhance just the controls. Panel DOM belongs to the document, including its links and islands. */
export function DocumentTabs(): React.JSX.Element {
  const strip = useRef<HTMLDivElement>(null);
  const instance = useId();
  const [panels, setPanels] = useState<DocumentPanel[]>([]);
  const [selected, setSelected] = useState(0);
  const group = strip.current?.closest<HTMLElement>('.lumen-tabs');
  const syncKey = group?.dataset.syncKey;

  useLayoutEffect(() => {
    const container = strip.current?.closest<HTMLElement>('.lumen-tabs');
    if (!container) return;
    const sections = Array.from(container.querySelectorAll<HTMLElement>(':scope > .lumen-tab-item'));
    const items: DocumentPanel[] = [];
    for (const section of sections) {
      const heading = section.querySelector<HTMLElement>(':scope > .lumen-tab-label');
      if (!heading) return;
      items.push({ section, heading, value: section.dataset.value ?? heading.textContent ?? '' });
    }
    const doc = container.ownerDocument;
    const anchor = fragmentTarget(doc);
    const peer = container.dataset.syncKey && Array.from(doc.querySelectorAll<HTMLElement>('.lumen-tabs[data-active-value]'))
      .find(item => item !== container && item.dataset.syncKey === container.dataset.syncKey);
    const anchored = items.findIndex(item => anchor && item.section.contains(anchor));
    const anchorPanel = anchor?.closest<HTMLElement>('.lumen-tab-item');
    const anchorGroup = anchorPanel?.parentElement;
    const anchorValue = container.dataset.syncKey && anchorGroup?.dataset.syncKey === container.dataset.syncKey
      ? anchorPanel?.dataset.value : undefined;
    const synced = items.findIndex(item => item.value === (anchorValue ?? (peer && peer.dataset.activeValue)));
    setSelected(anchored >= 0 ? anchored : Math.max(0, synced));
    setPanels(items);
  }, []);

  useLayoutEffect(() => {
    const tabs = strip.current?.querySelectorAll<HTMLElement>('[role="tab"]');
    if (!group || !panels.length || tabs?.length !== panels.length) return undefined;
    panels.forEach(({ section, heading }, index) => {
      const tab = tabs[index]!;
      section.id = `${instance}-panel-${index}`;
      section.setAttribute('role', 'tabpanel');
      section.setAttribute('aria-labelledby', tab.id);
      section.tabIndex = 0;
      tab.setAttribute('aria-controls', section.id);
      heading.hidden = true;
      section.hidden = index !== selected;
    });
    group.dataset.activeValue = panels[selected]!.value;
    return () => {
      delete group.dataset.activeValue;
      for (const { section, heading } of panels) {
        section.hidden = false;
        heading.hidden = false;
        for (const attribute of ['id', 'role', 'aria-labelledby', 'tabindex']) section.removeAttribute(attribute);
      }
    };
  }, [group, instance, panels, selected]);

  useEffect(() => {
    if (!group || !panels.length) return undefined;
    const doc = group.ownerDocument;
    const onSync = (event: Event) => {
      const choice = (event as CustomEvent<TabPreference>).detail;
      if (!choice || choice.key !== syncKey) return;
      const index = panels.findIndex(item => item.value === choice.value);
      if (index >= 0) setSelected(index);
    };
    const onHashChange = () => {
      const anchor = fragmentTarget(doc);
      const index = panels.findIndex(item => anchor && item.section.contains(anchor));
      if (index >= 0) {
        setSelected(index);
        if (syncKey) doc.dispatchEvent(new CustomEvent<TabPreference>(syncEvent, { detail: { key: syncKey, value: panels[index]!.value } }));
      }
    };
    if (syncKey) doc.addEventListener(syncEvent, onSync);
    doc.defaultView?.addEventListener('hashchange', onHashChange);
    return () => {
      if (syncKey) doc.removeEventListener(syncEvent, onSync);
      doc.defaultView?.removeEventListener('hashchange', onHashChange);
    };
  }, [group, panels, syncKey]);

  function select(value: string) {
    const index = Number(value);
    setSelected(index);
    if (syncKey) group?.ownerDocument.dispatchEvent(new CustomEvent<TabPreference>(syncEvent, { detail: { key: syncKey, value: panels[index]!.value } }));
  }

  return <div ref={strip}>{panels.length > 0 && <Tabs
    aria-label={group?.dataset.label || panels.map(item => item.heading.textContent).join(' / ')}
    tabs={panels.map((item, index) => ({ label: item.heading.textContent ?? item.value, value: String(index) }))}
    value={String(selected)}
    onChange={select}
    selectionFollowsFocus
    variant="scrollable"
    scrollButtons="auto"
  />}</div>;
}

