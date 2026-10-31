/** One command vocabulary for menus, keyboard hints and the palette. */
export const WORKSPACE_COMMANDS = {
  refresh: { title: 'Refresh current view', key: 'r', hint: 'R' },
  search: { title: 'Focus search or filter', key: '/', hint: '/' },
  fit: { title: 'Fit topology graph', key: '0', hint: '0' },
  readable: { title: 'Readable topology view', key: '1', hint: '1' },
  latest: { title: 'Jump to latest logs', key: 'Home', hint: 'Home' },
} as const;
export type WorkspaceCommand = keyof typeof WORKSPACE_COMMANDS;

export function isEditing(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]'))
  );
}

export function ownsKeyboard(target: EventTarget | null): boolean {
  return (
    target instanceof Element && Boolean(target.closest('[data-keyboard-native],.xterm,.cm-editor,.monaco-editor'))
  );
}

export function isVisible(element: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.hidden || node.inert || node.getAttribute('aria-hidden') === 'true') return false;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

export function commandControl(
  command: WorkspaceCommand,
  active: Element | null = document.activeElement
): HTMLElement | null {
  const root = document.getElementById('main-content');
  if (!root) return null;
  const region = active?.closest('[data-keyboard-region]');
  const candidates = [
    ...root.querySelectorAll<HTMLElement>(
      `[data-console-command="${command}"]${command === 'search' ? ',[data-keyboard-search]' : ''}`
    ),
  ].filter(isVisible);
  return candidates.find((element) => region?.contains(element)) ?? candidates[0] ?? null;
}

export function controlDisabled(element: HTMLElement): boolean {
  return element.matches(':disabled,[aria-disabled="true"]') || Boolean(element.closest('[inert]'));
}

export function invokeControl(command: WorkspaceCommand, element: HTMLElement): void {
  if (!element.isConnected || !isVisible(element) || controlDisabled(element)) return;
  if (command === 'search') {
    const input = element.matches('input,textarea')
      ? element
      : element.querySelector<HTMLElement>('input,textarea,[contenteditable="true"]');
    input?.focus();
  } else element.click();
}

export function focusRegions(): HTMLElement[] {
  const explicit = [...document.querySelectorAll<HTMLElement>('[data-keyboard-region],nav[aria-label]')].filter(
    isVisible
  );
  const main = document.getElementById('main-content');
  if (main && isVisible(main) && !explicit.some((element) => main.contains(element) && element.dataset.keyboardRegion !== 'Page tools')) explicit.push(main);
  return explicit;
}

export function focusRegion(direction = 1): void {
  const regions = focusRegions();
  if (!regions.length) return;
  const current = document.activeElement?.closest('[data-keyboard-region],nav[aria-label]');
  const index = current
    ? regions.indexOf(current as HTMLElement)
    : regions.findIndex((region) => region.contains(document.activeElement));
  const next =
    regions[
      index < 0 ? (direction > 0 ? 0 : regions.length - 1) : (index + direction + regions.length) % regions.length
    ]!;
  const preferred = next.id === 'main-content' ? next : [...next.querySelectorAll<HTMLElement>('[data-keyboard-focus]')].find(isVisible);
  const focus =
    preferred ??
    [
      ...next.querySelectorAll<HTMLElement>(
        '[data-keyboard-focus],button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href],[role=combobox]'
      ),
    ]
      .filter(isVisible)
      .find((element) => !controlDisabled(element)) ??
    next;
  if (!focus.hasAttribute('tabindex') && focus === next) focus.tabIndex = -1;
  focus.focus({ preventScroll: true });
  focus.scrollIntoView?.({ block: 'nearest' });
}
