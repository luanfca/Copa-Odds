'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

export type WsEventType =
  | 'scrape:start'
  | 'scrape:complete'
  | 'scrape:error'
  | 'match:update'
  | 'odds:update'
  | 'system';

export interface WsEvent {
  type: WsEventType;
  timestamp: string | number;
  data?: Record<string, unknown>;
}

export interface UseLiveConnectorOptions {
  /** WebSocket URL (defaults to ws://localhost:3002) */
  wsUrl?: string;
  /** Reconnect interval in ms (default: 5000) */
  reconnectIntervalMs?: number;
  /** Maximum reconnect attempts before giving up (default: Infinity) */
  maxReconnectAttempts?: number;
  /** Callback for incoming events */
  onEvent?: (event: WsEvent) => void;
  /** Callback when connected */
  onConnect?: () => void;
  /** Callback when disconnected */
  onDisconnect?: (reason?: string) => void;
  /** Whether to auto-connect on mount (default: true) */
  autoConnect?: boolean;
}

interface UseLiveConnectorReturn {
  /** Current connection status */
  status: 'connecting' | 'connected' | 'disconnected';
  /** Connect manually */
  connect: () => void;
  /** Disconnect manually */
  disconnect: () => void;
  /** Last event received */
  lastEvent: WsEvent | null;
  /** Connection error message */
  error: string | null;
}

function defaultWsUrl(): string {
  if (typeof window === 'undefined') {
    return `ws://127.0.0.1:${process.env.NEXT_PUBLIC_WS_PORT || '3002'}`;
  }
  // URL explícita tem prioridade em qualquer ambiente.
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;

  // Em produção, Caddy publica o WebSocket no mesmo domínio em /ws.
  // Isso evita expor uma segunda porta e mantém a conexão sob HTTPS.
  if (window.location.protocol === 'https:') {
    return `wss://${window.location.host}/ws`;
  }

  // Em desenvolvimento, WS fica em porta separada no mesmo hostname.
  const port =
    (window as Window & { __WS_PORT__?: string }).__WS_PORT__ ||
    process.env.NEXT_PUBLIC_WS_PORT ||
    '3002';
  return `ws://${window.location.hostname}:${port}`;
}
const DEFAULT_WS_URL = defaultWsUrl();

export function useLiveConnector(options: UseLiveConnectorOptions = {}): UseLiveConnectorReturn {
  const {
    wsUrl = DEFAULT_WS_URL,
    reconnectIntervalMs = 5000,
    maxReconnectAttempts = Infinity,
    onEvent,
    onConnect,
    onDisconnect,
    autoConnect = true,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCountRef = useRef(0);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>(
    autoConnect ? 'connecting' : 'disconnected',
  );
  const [lastEvent, setLastEvent] = useState<WsEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cleanup = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    cleanup();
    setError(null);

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('connected');
        reconnectCountRef.current = 0;
        onConnect?.();
      };

      ws.onmessage = (event) => {
        try {
          const data: WsEvent = JSON.parse(event.data as string);
          setLastEvent(data);
          onEvent?.(data);
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onerror = () => {
        setError('WebSocket connection error');
      };

      ws.onclose = (event) => {
        setStatus('disconnected');
        onDisconnect?.(event.reason || 'Connection closed');

        // Attempt reconnect
        if (reconnectCountRef.current < maxReconnectAttempts) {
          reconnectCountRef.current++;
          const delay = Math.min(
            reconnectIntervalMs * Math.pow(1.5, reconnectCountRef.current - 1),
            30000,
          );
          setTimeout(() => {
            if (wsRef.current === null || wsRef.current.readyState === WebSocket.CLOSED) {
              connect();
            }
          }, delay);
        }
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
      setStatus('disconnected');
    }
  }, [wsUrl, reconnectIntervalMs, maxReconnectAttempts, cleanup, onConnect, onDisconnect, onEvent]);

  const disconnect = useCallback(() => {
    reconnectCountRef.current = maxReconnectAttempts; // Prevent reconnect
    cleanup();
    setStatus('disconnected');
  }, [cleanup, maxReconnectAttempts]);

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect) {
      connect();
    }
    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { status, connect, disconnect, lastEvent, error };
}

/**
 * Hook that automatically triggers Next.js revalidation on scrape events.
 */
export function useScrapeAutoRefresh() {
  const { lastEvent, status } = useLiveConnector({
    onEvent: (event) => {
      if (event.type === 'scrape:complete' || event.type === 'odds:update') {
        // Invalida cache client-side de mercados e recarrega a página
        try {
          // dynamic import evita dependência circular no bundle
          import('@/lib/marketCache').then(({ invalidateMarket }) => {
            invalidateMarket();
          }).catch(() => null);
        } catch { /* */ }
        if (typeof window !== 'undefined') {
          // Soft signal: componentes que escutam storage/event recarregam
          window.dispatchEvent(new CustomEvent('odds:cache-invalidate'));
        }
      }
    },
  });

  return { lastEvent, status };
}

// Re-export as named export for layout.tsx
export const LiveConnector = useLiveConnector;
