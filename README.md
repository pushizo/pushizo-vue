<!-- pushizo:header -->
<p align="center">
  <a href="https://pushizo.com"><img src="https://raw.githubusercontent.com/pushizo/.github/main/profile/assets/mark.svg" alt="Pushizo" width="56" height="56"></a>
</p>
<p align="center">
  <a href="https://docs.pushizo.com/docs/integrations/vue"><img src="https://img.shields.io/badge/docs-docs.pushizo.com-5b4bdb" alt="Docs"></a>
  <a href="https://docs.pushizo.com/docs/api"><img src="https://img.shields.io/badge/API-reference-b44fc4" alt="API reference"></a>
  <a href="https://github.com/pushizo/pushizo-vue/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-16130f" alt="License: MIT"></a>
</p>
<p align="center"><a href="#english">English</a> · <a href="#türkçe">Türkçe</a></p>

## English

**Pushizo for Vue** — Vue plugin for the Pushizo Web SDK. app.use(PushizoPlugin, options) initializes the shared SDK once in the browser (SSR safe); the usePushizo composable exposes reactive permission and push subscription state, and $pushizo is available in every component. Works with Vue 3 and Vue 2.7.

> **Status:** @pushizo/vue 0.1.0 is not on npm yet; until then you can install the release archive from this repository.<br>
> **Durum:** @pushizo/vue 0.1.0 henüz npm'de değil; o zamana kadar bu deponun sürüm arşivinden kurabilirsiniz.

**Install from GitHub until then · O zamana kadar GitHub'dan kurulum:**

```bash
npm install @pushizo/web --allow-remote=root https://github.com/pushizo/pushizo-vue/releases/download/v0.1.0/pushizo-vue-0.1.0.tgz
```

**After publication · Yayından sonra:**

```bash
npm install @pushizo/vue @pushizo/web
```

The detailed guide below is in Turkish; code samples are language-neutral. Full documentation:
[docs.pushizo.com/docs/integrations/vue](https://docs.pushizo.com/docs/integrations/vue) · API reference: [docs.pushizo.com/docs/api](https://docs.pushizo.com/docs/api).

## Türkçe
<!-- /pushizo:header -->

# @pushizo/vue

Pushizo Web SDK'sı (`@pushizo/web`) için Vue eklentisi: `app.use(PushizoPlugin, options)` paylaşılan SDK örneğini
tarayıcıda bir kez başlatır, `usePushizo()` composable'ı izin ve push abonelik durumunu reaktif olarak verir,
bileşenlerde `$pushizo` global özelliği kullanılabilir.

- Vue 3 ve Vue 2.7 aynı pakettir (yalnızca iki sürümde ortak Composition API kullanılır).
- SSR güvenli: sunucuda (Nuxt, `createSSRApp`) `init` çağrılmaz, gözlemci bağlanmaz.
- Eklenti birden çok kez kurulsa da SDK bir kez başlatılır. Vue 3'te uygulama sökülünce gözlemciler kaldırılır;
  `onNotificationClick` dinleyicisi bileşen kapsamı bitince kaldırılır.

## Kurulum

```bash
npm install @pushizo/vue @pushizo/web
```

Service worker site kökünde olmalıdır (`public/PushizoSDKWorker.js`):

```js
// public/PushizoSDKWorker.js
const apiUrl = new URL(self.location.href).searchParams.get('apiUrl') || 'https://api.pushizo.com';
importScripts(`${apiUrl.replace(/\/$/, '')}/sdk-web/PushizoSDKWorker.js`);
```

## Kullanım

```ts
// main.ts (Vue 3)
import { createApp } from 'vue';
import { PushizoPlugin } from '@pushizo/vue';
import App from './App.vue';

createApp(App).use(PushizoPlugin, { appId: 'app_…', serviceWorkerPath: '/PushizoSDKWorker.js' }).mount('#app');
```

```ts
// main.ts (Vue 2.7)
import Vue from 'vue';
import { PushizoPlugin } from '@pushizo/vue';

Vue.use(PushizoPlugin, { appId: 'app_…' });
```

```vue
<script setup lang="ts">
import { onNotificationClick, usePushizo } from '@pushizo/vue';

const { pushizo, ready, error, permission, pushSubscription } = usePushizo();
onNotificationClick(({ notification, result }) => {
  window.location.assign(result.url ?? notification.url ?? '/');
});
</script>

<template>
  <p v-if="error" role="alert">{{ error.message }}</p>
  <p v-else-if="!ready">Yükleniyor…</p>
  <p v-else-if="permission === 'unsupported'">Bu tarayıcı web push desteklemiyor.</p>
  <p v-else-if="permission === 'denied'">Bildirimler tarayıcı ayarlarından engellenmiş.</p>
  <button v-else-if="pushSubscription.optedIn" @click="pushizo.User.pushSubscription.optOut()">Bildirimleri kapat</button>
  <button v-else @click="pushizo.Notifications.requestPermission()">Bildirimlere izin ver</button>
</template>
```

Options API: `this.$pushizo.User.addTags({ plan: 'pro' })`.

## API

| Ad | Açıklama |
|----|----------|
| `PushizoPlugin` | `app.use(PushizoPlugin, options)` / `Vue.use(PushizoPlugin, options)`; `Pushizo.init` tarayıcıda bir kez. |
| `usePushizo()` | `{ pushizo, state, ready, error, permission, pushSubscription }` (salt okunur ref/computed). |
| `onNotificationClick(handler)` | Bildirim tıklaması dinleyicisi; kapsam bitince kaldırılır, dönen işlevle elle de kaldırılır. |
| `$pushizo` | Paylaşılan SDK örneği (tüm bileşenlerde). |

`init` hatası fırlatılmaz, `error` ref'ine yazılır. Vue 2.7'de uygulama düzeyinde söküm kancası olmadığından
gözlemciler sayfa ömrü boyunca bağlı kalır. TypeScript'te `$pushizo` tipi Vue 3'ün `ComponentCustomProperties`
arayüzüne eklenir.

Ayrıntılı rehber (Nuxt, login/logout, tag ve olaylar, bildirim kutusu): [Vue rehberi](https://docs.pushizo.com/docs/integrations/vue).

<!-- pushizo:footer -->
---

## Support · Destek

- **Guide · Rehber:** [docs.pushizo.com/docs/integrations/vue](https://docs.pushizo.com/docs/integrations/vue)
- **API reference & OpenAPI · API referansı ve OpenAPI:** [docs.pushizo.com/docs/api](https://docs.pushizo.com/docs/api) ·
  [pushizo-openapi](https://github.com/pushizo/pushizo-openapi)
- **Bugs & ideas · Hata ve öneri:** [Issues](https://github.com/pushizo/pushizo-vue/issues)
- **Security · Güvenlik:** please do not open public issues; email [security@pushizo.com](mailto:security@pushizo.com) ·
  herkese açık issue açmayın, bu adrese yazın.
- **Help · Destek:** [support@pushizo.com](mailto:support@pushizo.com)

This repository is mirrored automatically from the Pushizo main repository on every release. Please open an issue
instead of a pull request; fixes land in the main repository and ship with the next release.
Bu depo her sürümde Pushizo ana deposundan otomatik yansıtılır. Pull request yerine issue açın; düzeltmeler ana depoda
yapılır ve bir sonraki sürümle buraya gelir.

Released under the MIT License · MIT lisanslıdır — [LICENSE](https://github.com/pushizo/pushizo-vue/blob/main/LICENSE).
<!-- /pushizo:footer -->
