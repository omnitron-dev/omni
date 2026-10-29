'use client';

import { createContext, forwardRef, useContext, useMemo, type ComponentType, type ReactNode } from 'react';
import type { SvgIconProps } from '@mui/material/SvgIcon';

/** Semantic slots shared by controls, layouts and scientific tools. */
export const prismIconNames = [
  'add',
  'alignCenter',
  'alignJustify',
  'alignLeft',
  'alignRight',
  'arrowDown',
  'arrowLeft',
  'arrowRight',
  'arrowUp',
  'arrowUpRight',
  'bold',
  'bulletList',
  'calendar',
  'check',
  'checkList',
  'checkbox',
  'checkboxChecked',
  'checkboxMixed',
  'chevronDown',
  'chevronLeft',
  'chevronRight',
  'chevronUp',
  'clearMarks',
  'close',
  'codeBlock',
  'copy',
  'download',
  'drag',
  'empty',
  'error',
  'eye',
  'eyeOff',
  'filter',
  'firstPage',
  'fitView',
  'fullscreen',
  'fullscreenExit',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hardBreak',
  'horizontalRule',
  'image',
  'info',
  'inlineCode',
  'italic',
  'keyboard',
  'lastPage',
  'link',
  'lock',
  'menu',
  'more',
  'orderedList',
  'panelCollapse',
  'panelExpand',
  'paragraph',
  'play',
  'quote',
  'radio',
  'radioChecked',
  'redo',
  'remove',
  'search',
  'share',
  'star',
  'starEmpty',
  'strike',
  'success',
  'table',
  'underline',
  'undo',
  'unlink',
  'unlock',
  'upload',
  'warning',
  'zoomIn',
  'zoomOut',
] as const;
export type PrismIconName = (typeof prismIconNames)[number];
export type PrismIconComponent = ComponentType<SvgIconProps>;
export type PrismIconSet = Readonly<Partial<Record<PrismIconName, PrismIconComponent>>>;
const empty: PrismIconSet = Object.freeze({});
const IconContext = createContext<PrismIconSet>(empty);

/** Application-owned artwork; nested providers override only the supplied slots.
 * React context crosses MUI portals. No DOM rewriting or remote icon requests.
 */
export function PrismIconProvider({ icons, children }: { icons: PrismIconSet; children: ReactNode }) {
  const parent = useContext(IconContext);
  const value = useMemo(() => ({ ...parent, ...icons }), [parent, icons]);
  return <IconContext.Provider value={value}>{children}</IconContext.Provider>;
}

/** Stable component identity preserves focus and forwards the entire MUI SVG contract. */
export function createPrismIcon(name: PrismIconName, Fallback: PrismIconComponent) {
  const Icon = forwardRef<SVGSVGElement, SvgIconProps>(function PrismIconSlot(props, ref) {
    const icons = useContext(IconContext);
    const Component = icons[name] ?? Fallback;
    return <Component {...props} ref={ref} data-prism-icon={name} />;
  });
  Icon.displayName = `PrismIcon(${name})`;
  return Icon;
}
