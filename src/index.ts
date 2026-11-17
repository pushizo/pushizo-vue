/**
 * @pushizo/vue — Pushizo Web SDK'sı (`@pushizo/web`) için Vue eklentisi ve composable'lar.
 *
 * Vue 3 (`app.use(PushizoPlugin, options)`) ve Vue 2.7 (`Vue.use(PushizoPlugin, options)`) aynı paketle çalışır:
 * yalnızca iki sürümde ortak olan Composition API (`shallowRef`, `computed`, `onScopeDispose`) kullanılır.
 */
import {
  computed,
  getCurrentScope,
  onScopeDispose,
  shallowRef,
  watch,
  type ComputedRef,
  type Ref,
  type ShallowRef,
} from 'vue';
import type {
  ContentCardsViewHandle,
  ContentCardsViewOptions,
  ForegroundLifecycleEvent,
  InboxChangeEvent,
  InitOptions,
  NotificationClickEvent,
  PermissionState,
  PushSubscriptionState,
  PushizoSdk,
  SearchQueryOptions,
  SearchResponse,
} from '@pushizo/web';
import { getBinding, isBrowser, type PushizoState } from './binding.js';
import { acquire, installCount, release, state } from './state.js';

export type { PushizoState } from './binding.js';

/** Vue 3 uygulama nesnesinin eklentinin kullandığı kısmı. */
interface Vue3App {
  config: { globalProperties: Record<string, unknown> };
  unmount: (...args: never[]) => unknown;
  onUnmount?: (cb: () => void) => void;
}

/** Vue 2.7 kurucusunun (`Vue.use`) eklentinin kullandığı kısmı. */
interface Vue2Constructor {
  prototype: Record<string, unknown>;
  version?: string;
}

function isVue2(target: unknown): target is Vue2Constructor {
  return typeof target === 'function' && typeof (target as Vue2Constructor).prototype === 'object';
}

/** Vue 3 uygulaması sökülünce (`app.unmount`) çalışacak işlevi kaydeder. */
function onAppUnmount(app: Vue3App, cb: () => void): void {
  if (typeof app.onUnmount === 'function') {
    app.onUnmount(cb);
    return;
  }
  // Vue < 3.5: `onUnmount` yok; özgün `unmount` sarılır.
  const original = app.unmount.bind(app) as (...args: unknown[]) => unknown;
  app.unmount = (...args: unknown[]) => {
    cb();
    return original(...args);
  };
}

export const PushizoPlugin = {
  /**
   * Tarayıcıda `Pushizo.init(options)` çağrısını bir kez yapar, `$pushizo` global özelliğini tanımlar ve durum
   * gözlemcilerini bağlar. Sunucuda (SSR) yalnızca `$pushizo` tanımlanır; SDK başlatılmaz.
   * Vue 3'te uygulama sökülünce gözlemciler kaldırılır; Vue 2.7'de uygulama düzeyinde söküm kancası yoktur.
   */
  install(app: unknown, options: InitOptions): void {
    if (!options || typeof options !== 'object')
      throw new Error('PushizoPlugin: init seçenekleri gerekli (appId).');
    const binding = getBinding();
    if (isVue2(app)) app.prototype.$pushizo = binding.sdk;
    else (app as Vue3App).config.globalProperties.$pushizo = binding.sdk;

    acquire();
    void binding.init(options);
    if (!isVue2(app)) {
      let released = false;
      onAppUnmount(app as Vue3App, () => {
        if (released) return;
        released = true;
        release();
      });
    }
  },
};

export interface UsePushizo {
  /** Paylaşılan Pushizo SDK örneği. */
  pushizo: PushizoSdk;
  /** Tüm durum (salt okunur). */
  state: ComputedRef<PushizoState>;
  ready: ComputedRef<boolean>;
  error: ComputedRef<Error | null>;
  permission: ComputedRef<PermissionState>;
  pushSubscription: ComputedRef<PushSubscriptionState>;
}

/** SDK örneği ve reaktif durum. `PushizoPlugin` kurulmadan çağrılırsa açıklayıcı hata verir. */
export function usePushizo(): UsePushizo {
  if (installCount() === 0)
    throw new Error('usePushizo: önce app.use(PushizoPlugin, { appId }) çağrılmalı.');
  return {
    pushizo: getBinding().sdk,
    state: computed(() => state.value),
    ready: computed(() => state.value.ready),
    error: computed(() => state.value.error),
    permission: computed(() => state.value.permission),
    pushSubscription: computed(() => state.value.pushSubscription),
  };
}

/**
 * Bildirim tıklaması dinleyicisi. Bileşen (veya `effectScope`) içinde çağrılırsa kapsam sonlanınca kendiliğinden
 * kaldırılır; dönen işlev ile elle de kaldırılabilir. Tarayıcı dışında no-op.
 */
export function onNotificationClick(handler: (event: NotificationClickEvent) => void): () => void {
  if (!isBrowser()) return () => undefined;
  const remove = getBinding().sdk.Notifications.addClickListener(handler);
  const stop = () => {
    remove();
  };
  if (getCurrentScope()) onScopeDispose(stop);
  return stop;
}

/**
 * Ön plan bildirimi dinleyicisi (`event.preventDefault()` ile bildirim engellenebilir). Kapsam sonlanınca ya da
 * dönen işlev çağrılınca `Notifications.removeForegroundLifecycleListener` ile kaldırılır. Tarayıcı dışında no-op.
 */
export function onNotificationForeground(
  handler: (event: ForegroundLifecycleEvent) => void,
): () => void {
  if (!isBrowser()) return () => undefined;
  const notifications = getBinding().sdk.Notifications;
  notifications.addForegroundLifecycleListener(handler);
  const stop = () => notifications.removeForegroundLifecycleListener(handler);
  if (getCurrentScope()) onScopeDispose(stop);
  return stop;
}

/** Bayraklar her yenilendiğinde artan sayaç; gözlemci kapsam sonlanınca `FeatureFlags.removeObserver` ile kaldırılır. */
function useFlagVersion(): ShallowRef<number> {
  const version = shallowRef(0);
  if (!isBrowser()) return version;
  const flags = getBinding().sdk.FeatureFlags;
  const observer = () => {
    version.value += 1;
  };
  flags.addObserver(observer);
  if (getCurrentScope()) onScopeDispose(() => flags.removeObserver(observer));
  return version;
}

/**
 * Özellik bayrağı açık mı (reaktif). Değerler sunucudan yenilendiğinde güncellenir; SDK hazır olana kadar ve
 * sunucuda `defaultValue` döner. Bileşen `setup` içinde (ya da bir `effectScope` içinde) çağrılmalıdır.
 */
export function useFeatureFlag(key: string, defaultValue = false): ComputedRef<boolean> {
  const version = useFlagVersion();
  return computed(() => {
    void version.value;
    return state.value.ready
      ? getBinding().sdk.FeatureFlags.isEnabled(key, defaultValue)
      : defaultValue;
  });
}

/** Özellik bayrağının değeri (reaktif); bayrak kapalıysa ya da SDK hazır değilse `defaultValue`. */
export function useFeatureFlagValue<T = unknown>(
  key: string,
  defaultValue?: T,
): ComputedRef<T | undefined> {
  const version = useFlagVersion();
  return computed(() => {
    void version.value;
    return state.value.ready
      ? getBinding().sdk.FeatureFlags.getValue<T>(key, defaultValue)
      : defaultValue;
  });
}

/**
 * Bildirim kutusundaki okunmamış sayısı (rozet için). SDK hazır olunca bir kez sunucudan okunur, sonra
 * `Inbox.addObserver` olaylarıyla güncellenir; henüz bilinmiyorsa (ya da okuma başarısızsa) `null`.
 */
export function useInboxUnreadCount(): ShallowRef<number | null> {
  const count = shallowRef<number | null>(null);
  if (!isBrowser()) return count;
  const inbox = getBinding().sdk.Inbox;
  const observer = (event: InboxChangeEvent) => {
    count.value = event.unreadCount;
  };
  let active = true;
  inbox.addObserver(observer);
  const stopWatch = watch(
    () => state.value.ready,
    (ready) => {
      if (!ready) return;
      inbox.unreadCount().then(
        (value) => {
          if (active) count.value = value;
        },
        () => undefined,
      );
    },
    { immediate: true },
  );
  if (getCurrentScope())
    onScopeDispose(() => {
      active = false;
      stopWatch();
      inbox.removeObserver(observer);
    });
  return count;
}

export interface UseContentCards {
  /** Görünüm kurulamazsa (ör. betik yüklenemedi) hata; yoksa null. */
  error: ShallowRef<Error | null>;
  /** Akışı yeniden yükler (görünüm henüz kurulmadıysa hiçbir şey yapmaz). */
  refresh: () => Promise<void>;
}

/**
 * Hazır içerik kartı akışını şablon başvurusundaki öğeye çizer (`ContentCards.render`): öğe bağlanıp SDK hazır
 * olunca kurulur, öğe değişince ya da kapsam sonlanınca kaldırılır.
 * `const host = ref<HTMLElement | null>(null); useContentCards(host, { theme: 'auto' })` + `<div ref="host" />`.
 */
export function useContentCards(
  target: Ref<Element | null | undefined>,
  options: ContentCardsViewOptions = {},
): UseContentCards {
  const error = shallowRef<Error | null>(null);
  let handle: ContentCardsViewHandle | null = null;
  let generation = 0;
  const teardown = () => {
    generation += 1;
    handle?.destroy();
    handle = null;
  };
  if (isBrowser()) {
    const stopWatch = watch(
      () => (state.value.ready ? (target.value ?? null) : null),
      (element) => {
        teardown();
        if (!element) return;
        const current = generation;
        getBinding()
          .sdk.ContentCards.render(element, options)
          .then(
            (view) => {
              // Kurulum bitmeden öğe değiştiyse ya da kapsam sonlandıysa görünüm hemen kaldırılır.
              if (current === generation) handle = view;
              else view.destroy();
            },
            (err: unknown) => {
              if (current === generation)
                error.value = err instanceof Error ? err : new Error(String(err));
            },
          );
      },
      { immediate: true, flush: 'post' },
    );
    if (getCurrentScope())
      onScopeDispose(() => {
        stopWatch();
        teardown();
      });
  }
  return { error, refresh: () => handle?.refresh() ?? Promise.resolve() };
}

export interface UsePushizoSearch {
  /** Son tamamlanan aramanın yanıtı (sonuçlar, varsa AI yanıtı); henüz arama yoksa `null`. */
  response: ShallowRef<SearchResponse | null>;
  loading: ShallowRef<boolean>;
  error: ShallowRef<Error | null>;
  /** Arama yapar; boş metin durumu temizler. Art arda çağrılarda yalnızca son aramanın yanıtı yazılır. */
  search: (text: string, options?: SearchQueryOptions) => Promise<void>;
  /** Sonuç tıklamasını kaydeder (`Search.trackClick`); arama yapılmadıysa hiçbir şey yapmaz. */
  trackClick: (url: string, position?: number) => void;
  reset: () => void;
}

/** Site araması: kendi arama kutunuz için `Search.query` durumunu (yanıt, yükleniyor, hata) yönetir. */
export function usePushizoSearch(): UsePushizoSearch {
  const response = shallowRef<SearchResponse | null>(null);
  const loading = shallowRef(false);
  const error = shallowRef<Error | null>(null);
  let sequence = 0;
  const reset = () => {
    sequence += 1;
    response.value = null;
    loading.value = false;
    error.value = null;
  };
  const search = async (text: string, options?: SearchQueryOptions): Promise<void> => {
    if (!text.trim()) {
      reset();
      return;
    }
    const current = (sequence += 1);
    loading.value = true;
    error.value = null;
    try {
      const result = await getBinding().sdk.Search.query(text, options);
      if (current !== sequence) return;
      response.value = result;
      loading.value = false;
    } catch (err) {
      if (current !== sequence) return;
      error.value = err instanceof Error ? err : new Error(String(err));
      loading.value = false;
    }
  };
  const trackClick = (url: string, position?: number): void => {
    const queryId = response.value?.query_id;
    if (queryId) void getBinding().sdk.Search.trackClick(queryId, url, position);
  };
  if (getCurrentScope())
    onScopeDispose(() => {
      sequence += 1;
    });
  return { response, loading, error, search, trackClick, reset };
}

declare module 'vue' {
  interface ComponentCustomProperties {
    /** Paylaşılan Pushizo SDK örneği (`PushizoPlugin`). */
    $pushizo: PushizoSdk;
  }
}
