"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type WebSocketMessage = {
  type: string;
  data?: any;
  error?: string;
};

type UseWebSocketOptions = {
  apiBase: string;
  token: string;
  userId?: string;
  supportUserId?: string;
  streamType: "tickets" | "ticket-messages" | "transactions";
  ticketId?: string;
  enabled?: boolean;
  onMessage?: (message: WebSocketMessage) => void;
  onError?: (error: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
};

export function useWebSocket({
  apiBase,
  token,
  userId,
  supportUserId,
  streamType,
  ticketId,
  enabled = true,
  onMessage,
  onError,
  onConnect,
  onDisconnect,
}: UseWebSocketOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isActiveRef = useRef(true);
  const authFailedRef = useRef(false);
  const onMessageRef = useRef(onMessage);
  const onErrorRef = useRef(onError);
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);
  const maxReconnectAttempts = 10;
  const reconnectDelay = 1000;

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onConnectRef.current = onConnect;
  }, [onConnect]);

  useEffect(() => {
    onDisconnectRef.current = onDisconnect;
  }, [onDisconnect]);

  useEffect(() => {
    authFailedRef.current = false;
    reconnectAttemptsRef.current = 0;
  }, [token]);

  const connect = useCallback(() => {
    if (!enabled || !isActiveRef.current || !token) {
      setError("No authentication token");
      onErrorRef.current?.("No authentication token");
      return;
    }

    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    if (wsRef.current) {
      wsRef.current.close();
    }

    try {
      const wsProxyUrl = process.env.NEXT_PUBLIC_WS_PROXY_URL;
      const proxyIsInternal = !!wsProxyUrl && /interchange_proxy\.rlwy\.net/i.test(wsProxyUrl);
      const base = wsProxyUrl && !proxyIsInternal ? wsProxyUrl : apiBase;
      const wsBase = base.startsWith("ws://") || base.startsWith("wss://")
        ? base
        : base.startsWith("https://")
          ? base.replace(/^https:/, "wss:")
          : base.startsWith("http://")
            ? base.replace(/^http:/, "ws:")
            : `wss://${base}`;
      const normalizedBase = wsBase.replace(/\/+$/, "");
      const fullUrl = normalizedBase.endsWith("/api/ws")
        ? normalizedBase
        : `${normalizedBase}/api/ws`;
      
      const ws = new WebSocket(fullUrl);

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: "auth",
          token,
          userId,
          supportUserId,
        }));
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === "auth" && message.data?.authenticated) {
            setIsConnected(true);
            setError(null);
            reconnectAttemptsRef.current = 0;
            authFailedRef.current = false;
            
            ws.send(JSON.stringify({
              type: "subscribe",
              streamType,
              ticketId,
              userId,
              supportUserId,
            }));
            onConnectRef.current?.();
          } else if (message.type === "subscribed") {
            setIsConnected(true);
            setError(null);
            reconnectAttemptsRef.current = 0;
            authFailedRef.current = false;
          } else if (message.type === "error") {
            const errorMessage = message.error || "WebSocket error";
            setError(errorMessage);
            onErrorRef.current?.(errorMessage);
            if (/auth|unauthorized|access denied/i.test(errorMessage)) {
              authFailedRef.current = true;
              ws.close();
            }
          } else if (message.type === "ping") {
            ws.send(JSON.stringify({ type: "pong" }));
          } else {
            onMessageRef.current?.(message);
          }
        } catch (err) {
        }
      };

      ws.onerror = () => {
        setError("WebSocket connection error");
        onErrorRef.current?.("Connection error");
      };

      ws.onclose = (event) => {
        setIsConnected(false);
        onDisconnectRef.current?.();

        if (
          isActiveRef.current &&
          !authFailedRef.current &&
          reconnectAttemptsRef.current < maxReconnectAttempts
        ) {
          reconnectAttemptsRef.current++;
          const delay = reconnectDelay * Math.min(reconnectAttemptsRef.current, 5);
          reconnectTimeoutRef.current = setTimeout(() => {
            if (isActiveRef.current) {
              connect();
            }
          }, delay);
        } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          setError("Failed to reconnect after multiple attempts");
          onErrorRef.current?.("Connection lost. Please refresh the page.");
        }
      };

      wsRef.current = ws;
    } catch (err) {
      setError("Failed to create WebSocket connection");
      onError?.("Failed to create connection");
    }
  }, [apiBase, token, userId, supportUserId, streamType, ticketId, enabled]);

  const disconnect = useCallback(() => {
    isActiveRef.current = false;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    onDisconnect?.();
  }, [onDisconnect]);

  useEffect(() => {
    isActiveRef.current = true;
    if (enabled) {
      connect();
    }
    return () => {
      disconnect();
    };
  }, [connect, disconnect, enabled]);

  return { isConnected, error, reconnect: connect, disconnect };
}
