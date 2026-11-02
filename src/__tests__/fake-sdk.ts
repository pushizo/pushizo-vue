import { vi } from 'vitest';
import type {
  InitOptions,
  NotificationClickEvent,
  PermissionChangeEvent,
  PermissionState,
  PushSubscriptionState,
} from '@pushizo/web';

/**
 * `@pushizo/web` varsayılan örneğinin testlerde kullanılan sahte karşılığı: yalnızca bağlamaların dokunduğu genel
 * API (init, izin/abonelik gözlemcileri, tıklama dinleyicisi) taklit edilir; gözlemci sayıları denetlenebilir.
 */
export function createFakeSdk() {
  const permissionObservers = new Set<(e: PermissionChangeEvent) => void>();
  const subscriptionObservers = new Set<(s: PushSubscriptionState) => void>();
  const clickListeners = new Set<(e: NotificationClickEvent) => void>();
  let permission: PermissionState = 'default';
  let subscription: PushSubscriptionState = {
    id: null,
    token: null,
    optedIn: false,
    permission: 'default',
  };
  let initResult: () => Promise<void> = () => Promise.resolve();

  const sdk = {
    init: vi.fn((_options: InitOptions) => initResult()),
    Notifications: {
      get permission(): PermissionState {
        return permission;
      },
      addPermissionObserver(cb: (e: PermissionChangeEvent) => void) {
        permissionObservers.add(cb);
        return () => permissionObservers.delete(cb);
      },
      addClickListener(cb: (e: NotificationClickEvent) => void) {
        clickListeners.add(cb);
        return () => clickListeners.delete(cb);
      },
      requestPermission: vi.fn(async () => permission),
    },
    User: {
      pushSubscription: {
        get state(): PushSubscriptionState {
          return { ...subscription, permission };
        },
        addObserver(cb: (s: PushSubscriptionState) => void) {
          subscriptionObservers.add(cb);
          return () => subscriptionObservers.delete(cb);
        },
      },
    },
  };

  const control = {
    sdk,
    failNextInit(error: Error) {
      initResult = () => Promise.reject(error);
    },
    setPermission(next: PermissionState) {
      permission = next;
      for (const cb of [...permissionObservers])
        cb({ permission: next === 'granted', state: next });
    },
    setSubscription(next: Partial<PushSubscriptionState>) {
      subscription = { ...subscription, ...next };
      for (const cb of [...subscriptionObservers]) cb(sdk.User.pushSubscription.state);
    },
    click(event: NotificationClickEvent) {
      for (const cb of [...clickListeners]) cb(event);
    },
    counts() {
      return {
        permission: permissionObservers.size,
        subscription: subscriptionObservers.size,
        click: clickListeners.size,
      };
    },
    reset() {
      permissionObservers.clear();
      subscriptionObservers.clear();
      clickListeners.clear();
      permission = 'default';
      subscription = { id: null, token: null, optedIn: false, permission: 'default' };
      initResult = () => Promise.resolve();
      sdk.init.mockClear();
    },
  };
  return control;
}

export type FakeSdk = ReturnType<typeof createFakeSdk>;

export const CLICK: NotificationClickEvent = {
  notification: { title: 'Merhaba', body: 'Gövde', url: 'https://example.test/a', data: {} },
  result: { actionId: 'open', url: 'https://example.test/a' },
};
