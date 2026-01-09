"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type SSEMessage = {
  type: string;
  data?: any;
  error?: string;
};

type UseSSEOptions = {
  apiBase: string;
  token?: string;
  userId?: string;
  supportUserId?: string;
  streamType: "tickets" | "ticket-messages" | "transactions";
  ticketId?: string;
  onMessage?: (message: SSEMessage) => void;
  onError?: (error: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
};

export function useSSE({
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
}: UseSSEOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 10;
  const reconnectDelay = 1000;
  const isActiveRef = useRef(true);

  const buildURL = useCallback(() => {
    let url = "";
    if (streamType === "tickets") {
      url = `${apiBase}/api/tickets/stream?userId=${userId}`;
    } else if (streamType === "ticket-messages" && ticketId) {
      url = `${apiBase}/api/tickets/${ticketId}/messages/stream`;
      if (supportUserId) {
        url += `?supportUserId=${supportUserId}`;
      }
    } else if (streamType === "transactions") {
      url = `${apiBase}/api/transactions/stream?userId=${userId}`;
    }
    if (token && !url.includes("token=")) {
      url += url.includes("?") ? `&token=${encodeURIComponent(token)}` : `?token=${encodeURIComponent(token)}`;
    }
    return url;
  }, [apiBase, userId, supportUserId, streamType, ticketId, token]);

  const connect = useCallback(() => {
    if (!isActiveRef.current) return;
    if (eventSourceRef.current?.readyState === EventSource.OPEN) return;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const url = buildURL();
    if (!url) return;

    try {
      const eventSource = new EventSource(url, { withCredentials: true });

      eventSource.onopen = () => {
        setIsConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;
        onConnect?.();
      };

      eventSource.onmessage = (event) => {
        if (!isActiveRef.current) return;
        try {
          if (!event.data || event.data.trim() === "" || event.data.startsWith(":")) {
            return;
          }
          const data = JSON.parse(event.data);
          if (data.type === "error") {
            setError(data.error || "Stream error");
            onError?.(data.error || "Stream error");
          } else {
            onMessage?.(data);
          }
        } catch (err) {
          console.error("SSE parse error:", err);
        }
      };

      eventSource.onerror = (err) => {
        if (!isActiveRef.current) return;
        
        if (eventSource.readyState === EventSource.CLOSED || eventSource.readyState === EventSource.CONNECTING) {
          setIsConnected(false);
          eventSource.close();
          
          if (isActiveRef.current && reconnectAttemptsRef.current < maxReconnectAttempts) {
            reconnectAttemptsRef.current++;
            reconnectTimeoutRef.current = setTimeout(() => {
              if (isActiveRef.current) {
                connect();
              }
            }, reconnectDelay * Math.min(reconnectAttemptsRef.current, 5));
          } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
            setError("Failed to reconnect after multiple attempts");
            onError?.("Connection lost. Please refresh the page.");
          }
        }
      };

      eventSourceRef.current = eventSource;
    } catch (err) {
      setError("Failed to create SSE connection");
      onError?.("Failed to create connection");
    }
  }, [buildURL, onMessage, onError, onConnect]);

  const disconnect = useCallback(() => {
    isActiveRef.current = false;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
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
