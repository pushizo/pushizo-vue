import { vi } from 'vitest';
import type {
  ContentCardsViewOptions,
  ForegroundLifecycleEvent,
  InboxChangeEvent,
  InitOptions,
  NotificationClickEvent,
  PermissionChangeEvent,
  PermissionState,
  PushSubscriptionState,
  SearchQueryOptions,
  SearchResponse,
} from '@pushizo/web';

/**
 * `@pushizo/web` varsayılan örneğinin testlerde kullanılan sahte karşılığı: yalnızca bağlamaların dokunduğu genel
 * API (init, izin/abonelik gözlemcileri, tıklama ve ön plan dinleyicileri, özellik bayrakları, bildirim kutusu,
 * içerik kartı görünümü, site araması) taklit edilir; gözlemci sayıları denetlenebilir.
 */
export function createFakeSdk() {
  const permissionObservers = new Set<(e: PermissionChangeEvent) => void>();
  const subscriptionObservers = new Set<(s: PushSubscriptionState) => void>();
  const clickListeners = new Set<(e: NotificationClickEvent) => void>();
  const foregroundListeners = new Set<(e: ForegroundLifecycleEvent) => void>();
  const flagObservers = new Set<() => void>();
  const inboxObservers = new Set<(e: InboxChangeEvent) => void>();
  let flags: Record<string, { enabled: boolean; value?: unknown }> = {};
  let unread = 0;
  let cardViews = 0;
  let searchResult: (text: string) => Promise<SearchResponse> = (text) =>
    Promise.resolve(searchResponse(text));
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
      addForegroundLifecycleListener(cb: (e: ForegroundLifecycleEvent) => void) {
        foregroundListeners.add(cb);
        return () => foregroundListeners.delete(cb);
      },
      removeForegroundLifecycleListener: vi.fn((cb: (e: ForegroundLifecycleEvent) => void) => {
        foregroundListeners.delete(cb);
      }),
      requestPermission: vi.fn(async () => permission),
    },
    FeatureFlags: {
      isEnabled: (key: string, defaultValue = false): boolean =>
        flags[key]?.enabled ?? defaultValue,
      getValue: <T = unknown>(key: string, defaultValue?: T): T | undefined =>
        flags[key]?.enabled ? ((flags[key].value as T | undefined) ?? defaultValue) : defaultValue,
      addObserver(listener: () => void) {
        flagObservers.add(listener);
        return () => flagObservers.delete(listener);
      },
      removeObserver: vi.fn((listener: () => void) => {
        flagObservers.delete(listener);
      }),
    },
    Inbox: {
      unreadCount: vi.fn(async () => unread),
      addObserver(cb: (e: InboxChangeEvent) => void) {
        inboxObservers.add(cb);
        return () => inboxObservers.delete(cb);
      },
      removeObserver: vi.fn((cb: (e: InboxChangeEvent) => void) => {
        inboxObservers.delete(cb);
      }),
    },
    ContentCards: {
      render: vi.fn(async (_target: string | Element, _options?: ContentCardsViewOptions) => {
        cardViews += 1;
        let open = true;
        return {
          refresh: async (): Promise<void> => undefined,
          destroy: () => {
            if (open) cardViews -= 1;
            open = false;
          },
        };
      }),
    },
    Search: {
      query: vi.fn((text: string, _options?: SearchQueryOptions) => searchResult(text)),
      trackClick: vi.fn(async (_queryId: string, _url: string, _position?: number) => undefined),
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
    foreground(event: ForegroundLifecycleEvent) {
      for (const cb of [...foregroundListeners]) cb(event);
    },
    setFlags(next: Record<string, { enabled: boolean; value?: unknown }>) {
      flags = next;
      for (const cb of [...flagObservers]) cb();
    },
    setUnread(next: number) {
      unread = next;
    },
    inbox(event: InboxChangeEvent) {
      unread = event.unreadCount;
      for (const cb of [...inboxObservers]) cb(event);
    },
    searchWith(result: (text: string) => Promise<SearchResponse>) {
      searchResult = result;
    },
    /** Yeni sarmalayıcıların gözlemci ve görünüm sayıları (`counts` eski testlerle aynı kalır). */
    extraCounts() {
      return {
        foreground: foregroundListeners.size,
        flags: flagObservers.size,
        inbox: inboxObservers.size,
        cardViews,
      };
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
      foregroundListeners.clear();
      flagObservers.clear();
      inboxObservers.clear();
      flags = {};
      unread = 0;
      cardViews = 0;
      searchResult = (text) => Promise.resolve(searchResponse(text));
      sdk.Notifications.removeForegroundLifecycleListener.mockClear();
      sdk.FeatureFlags.removeObserver.mockClear();
      sdk.Inbox.removeObserver.mockClear();
      sdk.Inbox.unreadCount.mockClear();
      sdk.ContentCards.render.mockClear();
      sdk.Search.query.mockClear();
      sdk.Search.trackClick.mockClear();
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

/** Tek sonuçlu sahte arama yanıtı. */
export function searchResponse(text: string): SearchResponse {
  return {
    query_id: `q_${text}`,
    mode: 'search',
    results: [
      {
        id: 'doc_1',
        url: 'https://example.test/doc',
        title: text,
        heading: '',
        snippet: text,
        snippet_html: text,
      },
    ],
    answer: null,
    answer_status: null,
    answers_available: false,
  };
}

export const FOREGROUND: ForegroundLifecycleEvent = {
  notification: { title: 'Merhaba', body: 'Gövde', data: {} },
  preventDefault: () => undefined,
  display: () => Promise.resolve(),
};
