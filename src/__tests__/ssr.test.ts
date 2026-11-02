// @vitest-environment node
import { createSSRApp, defineComponent, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { describe, expect, it, vi } from 'vitest';
import * as web from '@pushizo/web';
import { onNotificationClick, PushizoPlugin, usePushizo } from '../index.js';
import type { FakeSdk } from './fake-sdk.js';

vi.mock('@pushizo/web', async () => {
  const { createFakeSdk } = await import('./fake-sdk.js');
  const fake = createFakeSdk();
  return { default: fake.sdk, Pushizo: fake.sdk, __fake: fake };
});

const fake = (web as unknown as { __fake: FakeSdk }).__fake;

describe('@pushizo/vue SSR', () => {
  it('sunucuda init çağrılmaz, gözlemci bağlanmaz ve sabit durum çizilir', async () => {
    const app = createSSRApp(
      defineComponent({
        setup() {
          const { ready, permission } = usePushizo();
          onNotificationClick(() => undefined);
          return () => h('span', `${ready.value}:${permission.value}`);
        },
      }),
    );
    app.use(PushizoPlugin, { appId: 'app_ssr' });
    expect(await renderToString(app)).toBe('<span>false:default</span>');
    expect(fake.sdk.init).not.toHaveBeenCalled();
    expect(fake.counts()).toEqual({ permission: 0, subscription: 0, click: 0 });
  });
});
