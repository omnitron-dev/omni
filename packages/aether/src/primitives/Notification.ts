/**
 * Notification - Notification system with stacking
 */

import { defineComponent } from '../core/component/index.js';
import type { WritableSignal } from '../core/reactivity/types.js';
import { signal } from '../core/reactivity/index.js';
import { jsx } from '../jsx-runtime.js';

export type NotificationPlacement = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

export interface NotificationData {
  id: string;
  title: string;
  description?: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  duration?: number;
  closable?: boolean;
}

export interface NotificationProps {
  placement?: NotificationPlacement;
  maxCount?: number;
  duration?: number;
}

const notifications: WritableSignal<NotificationData[]> = signal<NotificationData[]>([]);

let idCounter = 0;

export const notify = (data: Omit<NotificationData, 'id'>): string => {
  const id = `notification-${idCounter++}`;
  const notification: NotificationData = { id, ...data };

  notifications.set([...notifications(), notification]);

  if (data.duration !== 0) {
    setTimeout(() => {
      notifications.set(notifications().filter((n) => n.id !== id));
    }, data.duration ?? 4500);
  }

  return id;
};

export const closeNotification = (id: string) => {
  notifications.set(notifications().filter((n) => n.id !== id));
};

export const Notification = defineComponent<NotificationProps>((props) => {
  const placement = props.placement ?? 'topRight';
  const maxCount = props.maxCount ?? 5;

  return () => {
    const items = notifications().slice(0, maxCount);

    const positionStyle: any = {};
    if (placement.includes('top')) positionStyle.top = '16px';
    else positionStyle.bottom = '16px';
    if (placement.includes('Left')) positionStyle.left = '16px';
    else positionStyle.right = '16px';

    return jsx('div', {
      'data-notification-container': '',
      'data-placement': placement,
      style: { position: 'fixed', zIndex: 9999, ...positionStyle },
      children: items.map((item) =>
        jsx('div', {
          key: item.id,
          'data-notification': '',
          'data-type': item.type ?? 'info',
          role: 'alert',
          children: [
            jsx('div', { 'data-notification-title': '', children: item.title }),
            item.description && jsx('div', { 'data-notification-description': '', children: item.description }),
            item.closable !== false && jsx('button', { 'data-notification-close': '', onClick: () => closeNotification(item.id), children: '×' }),
          ],
        }),
      ),
    });
  };
});

export const NotificationProvider = Notification;
