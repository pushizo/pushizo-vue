/**
 * Eklentinin modül düzeyindeki reaktif durumu. Tek SDK örneği olduğundan durum uygulama başına değil paylaşılır;
 * kurulum sayacı son uygulama sökülünce gözlemcileri kaldırmak için tutulur.
 */
import { shallowRef } from 'vue';
import { getBinding, isBrowser, SERVER_STATE, type PushizoState } from './binding.js';

export const state = shallowRef<PushizoState>(SERVER_STATE);

let installs = 0;
let stopSync: (() => void) | null = null;

export function installCount(): number {
  return installs;
}

/** Kurulum sayısını artırır ve (tarayıcıda) bağlama ile durumu eşlemeye başlar. */
export function acquire(): void {
  installs += 1;
  if (stopSync || !isBrowser()) return;
  const binding = getBinding();
  state.value = binding.getState();
  const unsubscribe = binding.subscribe((next) => {
    state.value = next;
  });
  const disconnect = binding.connect();
  stopSync = () => {
    unsubscribe();
    disconnect();
  };
}

/** Kurulum sayısını azaltır; sıfıra inince gözlemciler kaldırılır. */
export function release(): void {
  installs = Math.max(0, installs - 1);
  if (installs === 0) {
    stopSync?.();
    stopSync = null;
  }
}

/** Yalnızca birim testleri için (paketin dışa aktarımlarında yer almaz). */
export function resetState(): void {
  stopSync?.();
  stopSync = null;
  installs = 0;
  state.value = SERVER_STATE;
}
