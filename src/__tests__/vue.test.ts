// @vitest-environment happy-dom
import { createApp, defineComponent, effectScope, h, nextTick, type Component } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as web from '@pushizo/web';
import { getBinding, resetBinding } from '../binding.js';
import { onNotificationClick, PushizoPlugin, usePushizo, type UsePushizo } from '../index.js';
import { resetState } from '../state.js';
import { CLICK, type FakeSdk } from './fake-sdk.js';

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
