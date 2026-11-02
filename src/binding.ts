/**
 * Çerçeveden bağımsız bağlama çekirdeği: paylaşılan `@pushizo/web` örneğini tek kez başlatır ve web SDK'nın
 * gözlemcilerinden (izin, push aboneliği) tek bir durum nesnesi üretir.
 *
 * Bu dosya `sdk/react`, `sdk/vue` ve `sdk/angular` paketlerinde aynı içerikle tutulur: her paket ayrı yayın birimidir
 * (ADR-0055 §1) ve ortak bir ara paket yayımlamamak için kopyalanır. Değişiklik üç dosyaya birlikte yapılır.
 */
import Pushizo from '@pushizo/web';
import type { InitOptions, PermissionState, PushSubscriptionState, PushizoSdk } from '@pushizo/web';

export interface PushizoState {
  /** `init` başarıyla tamamlandı. */
  ready: boolean;
  /** `init` hatası (ör. eksik `appId`); yoksa null. */
  error: Error | null;
  /** Tarayıcı bildirim izni (`Notifications.permission`). */
  permission: PermissionState;
  /** Push abonelik durumu (`User.pushSubscription.state`). */
  pushSubscription: PushSubscriptionState;
}

type StateListener = (state: PushizoState) => void;

/** Tarayıcı dışı (SSR, Node, worker) ortamda SDK'ya dokunulmaz. */
export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/** Sunucuda ve hidrasyonun ilk çiziminde kullanılan sabit durum. */
export const SERVER_STATE: PushizoState = Object.freeze({
  ready: false,
  error: null,
  permission: 'default',
  pushSubscription: Object.freeze({ id: null, token: null, optedIn: false, permission: 'default' }),
});

function sameSubscription(a: PushSubscriptionState, b: PushSubscriptionState): boolean {
  return (
    a.id === b.id && a.token === b.token && a.optedIn === b.optedIn && a.permission === b.permission
  );
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

export class PushizoBinding {
  private state: PushizoState;
  private readonly listeners = new Set<StateListener>();
  private initPromise: Promise<void> | null = null;
  private connections = 0;
  private detach: (() => void) | null = null;

  constructor(readonly sdk: PushizoSdk) {
    this.state = isBrowser() ? this.read(false, null) : SERVER_STATE;
  }

  getState = (): PushizoState => this.state;

  /** Durum değişikliği aboneliği; dönen fonksiyon aboneliği kaldırır. */
  subscribe = (listener: StateListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * SDK'yı bir kez başlatır. Tekrarlanan çağrılar (React StrictMode, birden çok eklenti kurulumu) ilk çağrının
   * sözünü döndürür; sonraki seçenekler yok sayılır. Söz reddedilmez: hata `state.error` alanına yazılır.
   * Tarayıcı dışında hiçbir şey yapmaz.
   */
  init(options: InitOptions): Promise<void> {
    if (!isBrowser()) return Promise.resolve();
    if (!this.initPromise) {
      this.initPromise = this.sdk.init(options).then(
        () => this.update({ ready: true, error: null }),
        (err: unknown) => this.update({ ready: false, error: toError(err) }),
      );
    }
    return this.initPromise;
  }

  /**
   * Web SDK gözlemcilerini bağlar (referans sayımlı). Son bağlantı kapanınca gözlemciler kaldırılır.
   * Tarayıcı dışında no-op döndürür.
   */
  connect(): () => void {
    if (!isBrowser()) return () => undefined;
    this.connections += 1;
    if (this.connections === 1) {
      const refresh = () => this.update({});
      const offPermission = this.sdk.Notifications.addPermissionObserver(refresh);
      const offSubscription = this.sdk.User.pushSubscription.addObserver(refresh);
      this.detach = () => {
        offPermission();
        offSubscription();
      };
      // Bağlantı kapalıyken kaçırılmış değişiklikler okunur.
      refresh();
    }
    let open = true;
    return () => {
      if (!open) return;
      open = false;
      this.connections -= 1;
      if (this.connections === 0) {
        this.detach?.();
        this.detach = null;
      }
    };
  }

  /** Etkin gözlemci bağlantısı sayısı (test ve tanılama amaçlı). */
  get connectionCount(): number {
    return this.connections;
  }

  private read(ready: boolean, error: Error | null): PushizoState {
    const subscription = this.sdk.User.pushSubscription.state;
    return {
      ready,
      error,
      permission: this.sdk.Notifications.permission,
      pushSubscription: subscription,
    };
  }

  private update(patch: Partial<Pick<PushizoState, 'ready' | 'error'>>): void {
    const prev = this.state;
    const next = this.read(
      patch.ready ?? prev.ready,
      patch.error !== undefined ? patch.error : prev.error,
    );
    if (
      next.ready === prev.ready &&
      next.error === prev.error &&
      next.permission === prev.permission &&
      sameSubscription(next.pushSubscription, prev.pushSubscription)
    )
      return;
    // Değişmeyen abonelik nesnesi korunur: seçici tabanlı abonelikler gereksiz yeniden çizim yapmaz.
    if (sameSubscription(next.pushSubscription, prev.pushSubscription))
      next.pushSubscription = prev.pushSubscription;
    this.state = next;
    for (const listener of [...this.listeners]) listener(next);
  }
}

let shared: PushizoBinding | null = null;

/** Paylaşılan `@pushizo/web` örneğine bağlı tekil bağlama. */
export function getBinding(): PushizoBinding {
  shared ??= new PushizoBinding(Pushizo);
  return shared;
}

/** Yalnızca birim testleri için: tekil bağlamayı sıfırlar (paketin dışa aktarımlarında yer almaz). */
export function resetBinding(): void {
  shared = null;
}
