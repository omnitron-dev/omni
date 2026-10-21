'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Editor } from '@tiptap/core';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import {
  dispatchBlockTransaction,
  currentBlock,
  findBlock,
  moveBlockTransaction,
  runBlockAction,
  type ResearchBlockAction,
} from './block-commands.js';
import type { ResearchEditorLabels } from './editor.js';

type Anchor = { id: string; top: number };
/** One contextual control surface for the whole document, not a React subtree per paragraph. */
export function BlockControls({
  editor,
  container,
  labels,
  readOnly,
  onInsert,
  onSource,
}: {
  editor: Editor;
  container: RefObject<HTMLDivElement | null>;
  labels: ResearchEditorLabels;
  readOnly: boolean;
  onInsert: (id: string) => void;
  onSource: (id: string) => void;
}) {
  const [anchor, setAnchor] = useState<Anchor>();
  const [menu, setMenu] = useState<{ id: string; element: HTMLElement }>();
  const [dropTop, setDropTop] = useState<number>();
  const dragged = useRef<string | undefined>(undefined);
  useEffect(() => {
    const host = container.current;
    if (!host || readOnly) {
      setAnchor(undefined);
      setMenu(undefined);
      setDropTop(undefined);
      return undefined;
    }
    let hovered: HTMLElement | undefined;
    let frame = 0;
    const selectedElement = () => {
      const selected = currentBlock(editor);
      const element = selected && editor.view.nodeDOM(selected.pos);
      return element instanceof HTMLElement ? element : undefined;
    };
    const update = () => {
      frame = 0;
      const element = hovered && editor.view.dom.contains(hovered) ? hovered : selectedElement();
      const id = element?.getAttribute('data-research-block');
      if (!id || !element) {
        setAnchor(undefined);
        return;
      }
      const top = element.getBoundingClientRect().top - host.getBoundingClientRect().top;
      setAnchor((old) => (old?.id === id && old.top === top ? old : { id, top }));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const elementAt = (target: EventTarget | null) => {
      const element = target instanceof Element ? target.closest<HTMLElement>('[data-research-block]') : null;
      return element && editor.view.dom.contains(element) ? element : undefined;
    };
    const pointer = (event: PointerEvent) => {
      if (dragged.current) return;
      const element = elementAt(event.target);
      if (element) {
        hovered = element;
        schedule();
      }
    };
    const selected = () => {
      hovered = undefined;
      schedule();
    };
    const clearDrop = () => {
      dragged.current = undefined;
      setDropTop(undefined);
    };
    const destination = (event: DragEvent) => {
      const element = elementAt(event.target);
      if (!element) return undefined;
      const id = element.getAttribute('data-research-block')!;
      const block = findBlock(editor.state.doc, id);
      if (!block) return undefined;
      const rect = element.getBoundingClientRect();
      const before = event.clientY < rect.top + rect.height / 2;
      return {
        id: before
          ? id
          : block.index + 1 < editor.state.doc.childCount
            ? String(editor.state.doc.child(block.index + 1).attrs.id)
            : null,
        top: (before ? rect.top : rect.bottom) - host.getBoundingClientRect().top,
      };
    };
    const over = (event: DragEvent) => {
      if (!dragged.current || !editor.isEditable) return;
      const target = destination(event);
      if (!target) {
        setDropTop(undefined);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      setDropTop(target.top);
    };
    const drop = (event: DragEvent) => {
      if (!dragged.current) return;
      event.preventDefault();
      event.stopPropagation();
      const target = destination(event);
      const tr = editor.isEditable && target && moveBlockTransaction(editor.state, dragged.current, target.id);
      clearDrop();
      if (tr) dispatchBlockTransaction(editor, tr);
    };
    host.addEventListener('pointermove', pointer);
    host.addEventListener('dragover', over, true);
    host.addEventListener('drop', drop, true);
    window.addEventListener('dragend', clearDrop);
    editor.on('selectionUpdate', selected);
    editor.on('transaction', selected);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : undefined;
    observer?.observe(host);
    window.addEventListener('resize', schedule);
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      host.removeEventListener('pointermove', pointer);
      host.removeEventListener('dragover', over, true);
      host.removeEventListener('drop', drop, true);
      window.removeEventListener('dragend', clearDrop);
      window.removeEventListener('resize', schedule);
      editor.off('selectionUpdate', selected);
      editor.off('transaction', selected);
      dragged.current = undefined;
    };
  }, [editor, container, readOnly]);
  if (readOnly || !anchor) return null;
  const selected = menu && findBlock(editor.state.doc, menu.id);
  function action(kind: ResearchBlockAction) {
    if (menu) runBlockAction(editor, kind, menu.id);
    setMenu(undefined);
  }
  return (
    <>
      <div className="prism-science__gutter" style={{ top: anchor.top }} role="group" aria-label={labels.blockMenu}>
        <button
          type="button"
          title={labels.insert}
          aria-label={labels.insert}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onInsert(anchor.id)}
        >
          +
        </button>
        <button
          type="button"
          title={labels.dragBlock}
          aria-label={labels.blockMenu}
          aria-haspopup="menu"
          aria-expanded={!!menu}
          draggable
          onDragStart={(event) => {
            if (!editor.isEditable || !findBlock(editor.state.doc, anchor.id)) {
              event.preventDefault();
              return;
            }
            dragged.current = anchor.id;
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('application/x-prism-block', anchor.id);
            setMenu(undefined);
          }}
          onClick={(event) => setMenu({ id: anchor.id, element: event.currentTarget })}
        >
          <svg width="16" height="20" viewBox="0 0 16 20" aria-hidden="true">
            {[5, 10].flatMap((x) =>
              [5, 10, 15].map((y) => <circle key={`${x}:${y}`} cx={x} cy={y} r="1.2" fill="currentColor" />)
            )}
          </svg>
        </button>
      </div>
      {dropTop !== undefined && (
        <div className="prism-science__drop-line" style={{ top: dropTop }} aria-hidden="true" />
      )}
      <Menu open={!!menu} anchorEl={menu?.element} onClose={() => setMenu(undefined)}>
        <MenuItem
          disabled={!selected}
          onClick={() => {
            if (menu) onSource(menu.id);
            setMenu(undefined);
          }}
        >
          {labels.editBlock}
        </MenuItem>
        <MenuItem disabled={!selected || selected.index === 0} onClick={() => action('up')}>
          {labels.up}
        </MenuItem>
        <MenuItem
          disabled={!selected || selected.index === editor.state.doc.childCount - 1}
          onClick={() => action('down')}
        >
          {labels.down}
        </MenuItem>
        <MenuItem disabled={!selected} onClick={() => action('duplicate')}>
          {labels.duplicate}
        </MenuItem>
        <MenuItem disabled={!selected} onClick={() => action('remove')}>
          {labels.remove}
        </MenuItem>
      </Menu>
    </>
  );
}
