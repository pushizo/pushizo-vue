// @vitest-environment happy-dom
import { createApp, defineComponent, effectScope, h, nextTick, ref, type Component } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as web from '@pushizo/web';
import { getBinding, resetBinding } from '../binding.js';
import {
  onNotificationClick,
  onNotificationForeground,
  PushizoPlugin,
  useContentCards,
  useFeatureFlag,
  useFeatureFlagValue,
  useInboxUnreadCount,
  usePushizo,
  usePushizoSearch,
  type UsePushizo,
  type UsePushizoSearch,
} from '../index.js';
import { resetState } from '../state.js';
import { CLICK, FOREGROUND, searchResponse, type FakeSdk } from './fake-sdk.js';

vi.mock('@pushizo/web', async () => {
  const { createFakeSdk } = await import('./fake-sdk.js');
  const fake = createFakeSdk();
  return { default: fake.sdk, Pushizo: fake.sdk, __fake: fake };
});

const fake = (web as unknown as { __fake: FakeSdk }).__fake;
const OPTIONS = { appId: 'app_vue_test' };
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  fake.reset();
  resetBinding();
  resetState();
});

afterEach(() => {
  document.body.innerHTML = '';
});

function mount(component: Component) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(component);
  app.use(PushizoPlugin, OPTIONS);
  app.mount(el);
  return { app, el };
}

describe('@pushizo/vue (Vue 3)', () => {
  it('init bir kez çağrılır; $pushizo ve usePushizo paylaşılan örneği verir', async () => {
    let api: UsePushizo | null = null;
    let global: unknown;
    const { app, el } = mount(
      defineComponent({
        setup() {
          api = usePushizo();
          return () => h('span', `${api!.ready.value}:${api!.permission.value}`);
        },
        mounted() {
          global = (this as unknown as { $pushizo: unknown }).$pushizo;
        },
      }),
    );
    // İkinci uygulama aynı SDK'yı yeniden başlatmaz.
    const second = createApp({ render: () => null });
    second.use(PushizoPlugin, OPTIONS);
    await flush();
    await nextTick();
    expect(fake.sdk.init).toHaveBeenCalledTimes(1);
    expect(fake.sdk.init).toHaveBeenCalledWith(OPTIONS);
    expect(api!.pushizo).toBe(fake.sdk);
    expect(global).toBe(fake.sdk);
    expect(el.textContent).toBe('true:default');
    app.unmount();
  });

  it('izin ve abonelik değişiklikleri reaktif duruma yansır', async () => {
    const { app, el } = mount(
      defineComponent({
        setup() {
          const { permission, pushSubscription } = usePushizo();
          return () => h('span', `${permission.value}:${pushSubscription.value.optedIn}`);
        },
      }),
    );
    await flush();
    fake.setPermission('granted');
    fake.setSubscription({ id: 'sub_1', token: 'https://push.example.test/1', optedIn: true });
    await nextTick();
    expect(el.textContent).toBe('granted:true');
    fake.setPermission('denied');
    await nextTick();
    expect(el.textContent).toBe('denied:true');
    app.unmount();
  });

  it('init hatası error ref alanına yazılır', async () => {
    fake.failNextInit(new Error('appId gerekli'));
    let api: UsePushizo | null = null;
    const { app } = mount(
      defineComponent({
        setup() {
          api = usePushizo();
          return () => null;
        },
      }),
    );
    await flush();
    expect(api!.ready.value).toBe(false);
    expect(api!.error.value?.message).toBe('appId gerekli');
    app.unmount();
  });

  it('uygulama sökülünce gözlemciler, bileşen sökülünce tıklama dinleyicisi kaldırılır', async () => {
    const onClick = vi.fn();
    const { app } = mount(
      defineComponent({
        setup() {
          onNotificationClick(onClick);
          return () => null;
        },
      }),
    );
    expect(fake.counts()).toEqual({ permission: 1, subscription: 1, click: 1 });
    fake.click(CLICK);
    expect(onClick).toHaveBeenCalledWith(CLICK);
    app.unmount();
    expect(fake.counts()).toEqual({ permission: 0, subscription: 0, click: 0 });
    expect(getBinding().connectionCount).toBe(0);
  });

  it('onNotificationClick effectScope durunca kaldırılır', () => {
    const scope = effectScope();
    scope.run(() => onNotificationClick(() => undefined));
    expect(fake.counts().click).toBe(1);
    scope.stop();
    expect(fake.counts().click).toBe(0);
  });

  it('onNotificationForeground kapsam durunca removeForegroundLifecycleListener ile kaldırılır', () => {
    const onForeground = vi.fn();
    const scope = effectScope();
    scope.run(() => onNotificationForeground(onForeground));
    expect(fake.extraCounts().foreground).toBe(1);
    fake.foreground(FOREGROUND);
    expect(onForeground).toHaveBeenCalledWith(FOREGROUND);
    scope.stop();
    expect(fake.extraCounts().foreground).toBe(0);
    expect(fake.sdk.Notifications.removeForegroundLifecycleListener).toHaveBeenCalledWith(
      onForeground,
    );
  });

  it('useFeatureFlag bayrak yenilenince güncellenir; gözlemci removeObserver ile temizlenir', async () => {
    const { app, el } = mount(
      defineComponent({
        setup() {
          const enabled = useFeatureFlag('new_checkout');
          const limit = useFeatureFlagValue<number>('limit', 5);
          return () => h('span', `${enabled.value}:${limit.value}`);
        },
      }),
    );
    await flush();
    await nextTick();
    expect(el.textContent).toBe('false:5');
    expect(fake.extraCounts().flags).toBe(2);
    fake.setFlags({ new_checkout: { enabled: true }, limit: { enabled: true, value: 20 } });
    await nextTick();
    expect(el.textContent).toBe('true:20');
    app.unmount();
    expect(fake.extraCounts().flags).toBe(0);
    expect(fake.sdk.FeatureFlags.removeObserver).toHaveBeenCalledTimes(2);
  });

  it('useInboxUnreadCount ilk değeri okur, kutu olaylarıyla güncellenir ve gözlemciyi kaldırır', async () => {
    fake.setUnread(3);
    const { app, el } = mount(
      defineComponent({
        setup() {
          const count = useInboxUnreadCount();
          return () => h('span', String(count.value));
        },
      }),
    );
    await flush();
    await nextTick();
    expect(el.textContent).toBe('3');
    expect(fake.sdk.Inbox.unreadCount).toHaveBeenCalledTimes(1);
    fake.inbox({ type: 'read', itemId: 'in_1', unreadCount: 2 });
    await nextTick();
    expect(el.textContent).toBe('2');
    app.unmount();
    expect(fake.extraCounts().inbox).toBe(0);
  });

  it('useContentCards öğe bağlanıp SDK hazır olunca görünümü kurar, sökülünce kaldırır', async () => {
    const options = { theme: 'dark' as const };
    const { app, el } = mount(
      defineComponent({
        setup() {
          const host = ref<HTMLElement | null>(null);
          useContentCards(host, options);
          return () => h('div', { ref: host, class: 'cards' });
        },
      }),
    );
    await flush();
    await nextTick();
    await flush();
    expect(fake.sdk.ContentCards.render).toHaveBeenCalledTimes(1);
    expect(fake.sdk.ContentCards.render).toHaveBeenCalledWith(el.querySelector('.cards'), options);
    expect(fake.extraCounts().cardViews).toBe(1);
    app.unmount();
    expect(fake.extraCounts().cardViews).toBe(0);
  });

  it('useContentCards kurulum hatasını error alanına yazar', async () => {
    fake.sdk.ContentCards.render.mockRejectedValueOnce(new Error('betik yüklenemedi'));
    let error!: ReturnType<typeof useContentCards>['error'];
    const { app } = mount(
      defineComponent({
        setup() {
          const host = ref<HTMLElement | null>(null);
          ({ error } = useContentCards(host));
          return () => h('div', { ref: host });
        },
      }),
    );
    await flush();
    await nextTick();
    await flush();
    expect(error.value?.message).toBe('betik yüklenemedi');
    app.unmount();
  });

  it('usePushizoSearch yanıtı, hatayı ve tıklama kaydını yönetir; eski yanıt yenisinin üzerine yazmaz', async () => {
    const scope = effectScope();
    const api = scope.run(() => usePushizoSearch()) as UsePushizoSearch;
    api.trackClick('https://example.test/doc');
    expect(fake.sdk.Search.trackClick).not.toHaveBeenCalled();

    await api.search('fiyat', { limit: 3 });
    expect(fake.sdk.Search.query).toHaveBeenCalledWith('fiyat', { limit: 3 });
    expect(api.response.value?.query_id).toBe('q_fiyat');
    api.trackClick('https://example.test/doc', 1);
    expect(fake.sdk.Search.trackClick).toHaveBeenCalledWith(
      'q_fiyat',
      'https://example.test/doc',
      1,
    );

    let releaseSlow!: () => void;
    fake.searchWith((text) =>
      text === 'yavaş'
        ? new Promise((resolve) => {
            releaseSlow = () => resolve(searchResponse(text));
          })
        : Promise.resolve(searchResponse(text)),
    );
    const slow = api.search('yavaş');
    await api.search('hızlı');
    releaseSlow();
    await slow;
    expect(api.response.value?.query_id).toBe('q_hızlı');
    expect(api.loading.value).toBe(false);

    fake.searchWith(() => Promise.reject(new Error('arama kapalı')));
    await api.search('hata');
    expect(api.error.value?.message).toBe('arama kapalı');

    await api.search('  ');
    expect(api.response.value).toBeNull();
    expect(api.error.value).toBeNull();
    scope.stop();
  });

  it('eklenti kurulmadan usePushizo açıklayıcı hata verir; seçeneksiz kurulum reddedilir', () => {
    expect(() => usePushizo()).toThrow('PushizoPlugin');
    expect(() => createApp({}).use(PushizoPlugin, undefined as never)).toThrow('appId');
  });
});

describe('@pushizo/vue (Vue 2.7 kurucusu)', () => {
  it('Vue.use yolunda $pushizo prototipe yazılır ve init bir kez çağrılır', async () => {
    // Vue 2.7'de `Vue.use(plugin, options)` eklentiye kurucu işlevi verir.
    function Vue2() {}
    Vue2.version = '2.7.16';
    PushizoPlugin.install(Vue2, OPTIONS);
    PushizoPlugin.install(Vue2, OPTIONS);
    await flush();
    expect((Vue2.prototype as Record<string, unknown>).$pushizo).toBe(fake.sdk);
    expect(fake.sdk.init).toHaveBeenCalledTimes(1);
    expect(usePushizo().ready.value).toBe(true);
  });
});
