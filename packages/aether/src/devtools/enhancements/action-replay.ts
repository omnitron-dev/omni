/**
 * Action Replay System
 *
 * Records and replays user interactions.
 *
 * @module devtools/enhancements/action-replay
 */

import { signal } from '../../core/reactivity/signal.js';

export interface UserAction {
  id: string;
  type: 'click' | 'input' | 'scroll' | 'keypress' | 'focus' | 'blur';
  timestamp: number;
  target: string;
  data?: any;
}

export interface ReplayConfig {
  enabled?: boolean;
  maxActions?: number;
  recordClicks?: boolean;
  recordInputs?: boolean;
  recordScrolls?: boolean;
  recordKeypress?: boolean;
}

export class ActionReplaySystem {
  private config: Required<ReplayConfig>;
  private actions = signal<UserAction[]>([]);
  private recording = signal(false);
  private playing = signal(false);
  private actionId = 0;
  private listeners: Array<() => void> = [];

  constructor(config: ReplayConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      maxActions: config.maxActions ?? 1000,
      recordClicks: config.recordClicks ?? true,
      recordInputs: config.recordInputs ?? true,
      recordScrolls: config.recordScrolls ?? false,
      recordKeypress: config.recordKeypress ?? true,
    };
  }

  startRecording(): void {
    if (typeof document === 'undefined' || this.recording()) return;

    this.recording.set(true);
    this.actions.set([]);
    this.setupListeners();
  }

  stopRecording(): void {
    this.recording.set(false);
    this.removeListeners();
  }

  private setupListeners(): void {
    if (typeof document === 'undefined') return;

    if (this.config.recordClicks) {
      const clickListener = (e: MouseEvent) => this.recordClick(e);
      document.addEventListener('click', clickListener);
      this.listeners.push(() => document.removeEventListener('click', clickListener));
    }

    if (this.config.recordInputs) {
      const inputListener = (e: Event) => this.recordInput(e);
      document.addEventListener('input', inputListener);
      this.listeners.push(() => document.removeEventListener('input', inputListener));
    }

    if (this.config.recordKeypress) {
      const keyListener = (e: KeyboardEvent) => this.recordKeypress(e);
      document.addEventListener('keypress', keyListener);
      this.listeners.push(() => document.removeEventListener('keypress', keyListener));
    }
  }

  private removeListeners(): void {
    this.listeners.forEach((remove) => remove());
    this.listeners = [];
  }

  private recordClick(e: MouseEvent): void {
    this.addAction({
      id: `action-${this.actionId++}`,
      type: 'click',
      timestamp: Date.now(),
      target: this.getSelector(e.target as Element),
      data: { x: e.clientX, y: e.clientY },
    });
  }

  private recordInput(e: Event): void {
    const target = e.target as HTMLInputElement;
    this.addAction({
      id: `action-${this.actionId++}`,
      type: 'input',
      timestamp: Date.now(),
      target: this.getSelector(target),
      data: { value: target.value },
    });
  }

  private recordKeypress(e: KeyboardEvent): void {
    this.addAction({
      id: `action-${this.actionId++}`,
      type: 'keypress',
      timestamp: Date.now(),
      target: this.getSelector(e.target as Element),
      data: { key: e.key, code: e.code },
    });
  }

  private addAction(action: UserAction): void {
    const current = this.actions();
    current.push(action);

    if (current.length > this.config.maxActions) {
      current.shift();
    }

    this.actions.set([...current]);
  }

  private getSelector(element: Element | null): string {
    if (!element) return '';
    if (element.id) return `#${element.id}`;
    if (element.className) return `.${element.className.split(' ')[0]}`;
    return element.tagName.toLowerCase();
  }

  async replay(speed: number = 1): Promise<void> {
    if (this.playing()) return;

    this.playing.set(true);
    const actions = this.actions();

    for (let i = 0; i < actions.length; i++) {
      if (!this.playing()) break;

      const action = actions[i];
      const nextAction = actions[i + 1];

      if (action) {
        await this.executeAction(action);

        if (nextAction && action) {
          const delay = (nextAction.timestamp - action.timestamp) / speed;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    this.playing.set(false);
  }

  private async executeAction(action: UserAction): Promise<void> {
    if (typeof document === 'undefined') return;

    const element = document.querySelector(action.target);
    if (!element) return;

    switch (action.type) {
      case 'click':
        (element as HTMLElement).click();
        break;
      case 'input':
        if (element instanceof HTMLInputElement) {
          element.value = action.data?.value || '';
          element.dispatchEvent(new Event('input', { bubbles: true }));
        }
        break;
      case 'keypress':
        element.dispatchEvent(
          new KeyboardEvent('keypress', {
            key: action.data?.key,
            code: action.data?.code,
            bubbles: true,
          })
        );
        break;
      default:
        // Other action types (scroll, focus, blur) not implemented yet
        break;
    }
  }

  stopReplay(): void {
    this.playing.set(false);
  }

  getActions(): UserAction[] {
    return this.actions();
  }

  clearActions(): void {
    this.actions.set([]);
  }

  exportActions(): string {
    return JSON.stringify(this.actions(), null, 2);
  }

  importActions(json: string): void {
    try {
      const actions = JSON.parse(json);
      this.actions.set(actions);
    } catch (error) {
      console.error('Failed to import actions:', error);
    }
  }

  isRecording(): boolean {
    return this.recording();
  }

  isPlaying(): boolean {
    return this.playing();
  }
}

let globalReplaySystem: ActionReplaySystem | null = null;

export function getActionReplaySystem(config?: ReplayConfig): ActionReplaySystem {
  if (!globalReplaySystem) {
    globalReplaySystem = new ActionReplaySystem(config);
  }
  return globalReplaySystem;
}

export function resetActionReplaySystem(): void {
  if (globalReplaySystem) {
    globalReplaySystem.stopRecording();
    globalReplaySystem.stopReplay();
    globalReplaySystem = null;
  }
}
