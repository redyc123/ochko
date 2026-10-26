import { NotifyApp, type NotifyAppCode } from '../ble/protocol/display';
import type { GlassesApi } from '../glasses/api';
import { NotificationListener } from '../../modules/notification-listener';

/** Сколько уведомление висит на экране очков. */
export const NOTIFY_TTL_S = 5;

/** CategoryID из ANCS (okko/docs/PROTOCOL.md §5, событие NOTIFY). */
const ANCS_CATEGORY_TO_APP: Readonly<Record<number, NotifyAppCode>> = {
  1: NotifyApp.CALL,
  2: NotifyApp.CALL,
  4: NotifyApp.MESSENGER,
  5: NotifyApp.CALENDAR,
  6: NotifyApp.MAIL,
};

/** Notification.category на Android. */
const ANDROID_CATEGORY_TO_APP: Readonly<Record<string, NotifyAppCode>> = {
  call: NotifyApp.CALL,
  missed_call: NotifyApp.CALL,
  msg: NotifyApp.MESSENGER,
  email: NotifyApp.MAIL,
  event: NotifyApp.CALENDAR,
  reminder: NotifyApp.CALENDAR,
};

export function ancsCategoryToApp(category: number): NotifyAppCode {
  return ANCS_CATEGORY_TO_APP[category] ?? NotifyApp.OTHER;
}

export function androidCategoryToApp(category: string): NotifyAppCode {
  return ANDROID_CATEGORY_TO_APP[category] ?? NotifyApp.OTHER;
}

/**
 * Пересылает уведомления телефона на очки на NOTIFY_TTL_S секунд. Источники:
 * iPhone — очки сами читают ANCS и присылают событие NOTIFY; Android —
 * нативный NotificationListenerService (modules/notification-listener).
 * Показывать ли уведомление сейчас, решает FrameCompositor.
 */
export function startPhoneNotifications(api: GlassesApi): () => void {
  const show = (app: NotifyAppCode, title: string, body: string) => {
    void api.showNotify({ app, prio: 0, ttlS: NOTIFY_TTL_S, title, body }).catch(() => undefined);
  };

  const unsubscribeAncs = api.onPhoneNotification((category, title, message) =>
    show(ancsCategoryToApp(category), title, message),
  );
  const androidSubscription = NotificationListener?.addListener('onNotification', (n) =>
    show(androidCategoryToApp(n.category), n.title, n.text),
  );

  return () => {
    unsubscribeAncs();
    androidSubscription?.remove();
  };
}
