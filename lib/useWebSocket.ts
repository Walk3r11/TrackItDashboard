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
  const maxReconnectAttempts = 10;
  const reconnectDelay = 1000;

  const connect = useCallback(() => {
    if (!isActiveRef.current || !token) {
      setError("No authentication token");
      onError?.("No authentication token");
      return;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    if (wsRef.current) {
      wsRef.current.close();
    }

    try {
      const wsProxyUrl = process.env.NEXT_PUBLIC_WS_PROXY_URL;
      let fullUrl: string;
      
      if (wsProxyUrl) {
        fullUrl = wsProxyUrl.startsWith("ws://") || wsProxyUrl.startsWith("wss://") 
          ? `${wsProxyUrl}/api/ws`
          : `wss://${wsProxyUrl}/api/ws`;
      } else {
        const wsUrl = apiBase.replace(/^https?/, "wss").replace(/^http/, "ws");
        fullUrl = `${wsUrl}/api/ws`;
      }
      
      const ws = new WebSocket(fullUrl);

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0;
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
            
            ws.send(JSON.stringify({
              type: "subscribe",
              streamType,
              ticketId,
              userId,
              supportUserId,
            }));
            onConnect?.();
          } else if (message.type === "subscribed") {
            setIsConnected(true);
            setError(null);
          } else if (message.type === "error") {
            setError(message.error || "WebSocket error");
            onError?.(message.error || "WebSocket error");
          } else if (message.type === "ping") {
            ws.send(JSON.stringify({ type: "pong" }));
          } else {
            onMessage?.(message);
          }
        } catch (err) {
        }
      };

      ws.onerror = () => {
        setError("WebSocket connection error");
        onError?.("Connection error");
      };

      ws.onclose = (event) => {
        setIsConnected(false);
        onDisconnect?.();

        if (isActiveRef.current && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          const delay = reconnectDelay * Math.min(reconnectAttemptsRef.current, 5);
          reconnectTimeoutRef.current = setTimeout(() => {
            if (isActiveRef.current) {
              connect();
            }
          }, delay);
        } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          setError("Failed to reconnect after multiple attempts");
          onError?.("Connection lost. Please refresh the page.");
        }
      };

      wsRef.current = ws;
    } catch (err) {
      setError("Failed to create WebSocket connection");
      onError?.("Failed to create connection");
    }
  }, [apiBase, token, userId, supportUserId, streamType, ticketId, onMessage, onError, onConnect, onDisconnect]);

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
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return { isConnected, error, reconnect: connect, disconnect };
}
