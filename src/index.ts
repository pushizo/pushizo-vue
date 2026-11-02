/**
 * @pushizo/vue — Pushizo Web SDK'sı (`@pushizo/web`) için Vue eklentisi ve composable'lar.
 *
 * Vue 3 (`app.use(PushizoPlugin, options)`) ve Vue 2.7 (`Vue.use(PushizoPlugin, options)`) aynı paketle çalışır:
 * yalnızca iki sürümde ortak olan Composition API (`shallowRef`, `computed`, `onScopeDispose`) kullanılır.
 */
import { computed, getCurrentScope, onScopeDispose, type ComputedRef } from 'vue';
import type {
  InitOptions,
  NotificationClickEvent,
  PermissionState,
  PushSubscriptionState,
  PushizoSdk,
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

declare module 'vue' {
  interface ComponentCustomProperties {
    /** Paylaşılan Pushizo SDK örneği (`PushizoPlugin`). */
    $pushizo: PushizoSdk;
  }
}
