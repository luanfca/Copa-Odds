'use client';

import { useEffect } from 'react';
import { useLiveConnector } from './LiveConnector';

/**
 * Força atualização do Service Worker e limpa caches antigos.
 * Versões velhas cacheavam page.js com Bet365/Betsson e odds de mercado errado.
 */
function useServiceWorkerHygiene() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    let cancelled = false;

    (async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        // Re-registra sw.js novo (v4 network-first) e descarta controllers antigos
        for (const reg of regs) {
          try {
            await reg.update();
          } catch {
            /* ignore */
          }
        }

        // Se não houver SW, registra o atual (network-first para /_next)
        if (regs.length === 0) {
          await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        } else {
          // Garante que o sw.js mais recente está ativo
          await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        }

        // Limpa Cache Storage de versões antigas (odds-aovivo-v1/v2/v3)
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(
            keys
              .filter((k) => k.startsWith('odds-aovivo-') && k !== 'odds-aovivo-v4-4houses')
              .map((k) => caches.delete(k)),
          );
        }

        // Uma vez por sessão: se o controller for SW antigo, recarrega após claim
        const KEY = 'sw_hygiene_v4';
        if (!cancelled && !sessionStorage.getItem(KEY)) {
          sessionStorage.setItem(KEY, '1');
          const reg = await navigator.serviceWorker.ready;
          if (reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
        }
      } catch (err) {
        console.warn('[SW hygiene]', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);
}

export function ClientSideComponents() {
  useLiveConnector();
  useServiceWorkerHygiene();
  return null;
}
